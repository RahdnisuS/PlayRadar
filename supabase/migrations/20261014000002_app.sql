-- PlayRadar app additions on top of the base schema.

-- ============ AUTH LINK ============
-- public.users rows mirror Supabase Auth users (magic-link sign-in).
ALTER TABLE users
  ADD CONSTRAINT users_auth_fk FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, email_verified)
  VALUES (NEW.id, NEW.email, NEW.email_confirmed_at IS NOT NULL)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ============ CATALOG EXTRAS ============
ALTER TABLE games ADD COLUMN popularity REAL NOT NULL DEFAULT 0;   -- seed order + video backfill order
CREATE INDEX games_popularity_idx ON games (popularity DESC);

-- ============ SIMILAR-QUERY CACHE ============
ALTER TABLE chat_cache ADD COLUMN query_embedding vector(384);
ALTER TABLE chat_cache ADD COLUMN normalized_text TEXT;
CREATE INDEX chat_cache_expires_idx ON chat_cache (expires_at);

-- ============ RATE LIMITING (fixed window, no external service) ============
CREATE TABLE rate_limits (
  key          TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Returns TRUE when the request is allowed.
CREATE OR REPLACE FUNCTION hit_rate_limit(p_key TEXT, p_max INT, p_window_s INT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  w TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM now()) / p_window_s) * p_window_s);
  c INT;
BEGIN
  INSERT INTO rate_limits (key, window_start, count) VALUES (p_key, w, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO c;
  RETURN c <= p_max;
END $$;

-- ============ LLM DAILY CAPS ============
-- Atomically checks every scope against its cap and increments all of them only if all pass.
-- p_cost lets one chat turn reserve several calls (extract + explain).
CREATE OR REPLACE FUNCTION try_consume_llm(p_scopes TEXT[], p_caps INT[], p_cost INT DEFAULT 1)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  i INT;
  used INT;
BEGIN
  FOR i IN 1 .. array_length(p_scopes, 1) LOOP
    INSERT INTO llm_usage_daily (day, scope_key, calls) VALUES (current_date, p_scopes[i], 0)
    ON CONFLICT DO NOTHING;
    SELECT calls INTO used FROM llm_usage_daily
      WHERE day = current_date AND scope_key = p_scopes[i] FOR UPDATE;
    IF used + p_cost > p_caps[i] THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  UPDATE llm_usage_daily SET calls = calls + p_cost
    WHERE day = current_date AND scope_key = ANY (p_scopes);
  RETURN TRUE;
END $$;

-- ============ EMAIL DAILY CAP ============
CREATE TABLE email_usage_daily (
  day  DATE PRIMARY KEY,
  sent INT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION try_consume_email(p_cap INT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE c INT;
BEGIN
  INSERT INTO email_usage_daily (day, sent) VALUES (current_date, 0) ON CONFLICT DO NOTHING;
  UPDATE email_usage_daily SET sent = sent + 1
    WHERE day = current_date AND sent < p_cap
    RETURNING sent INTO c;
  RETURN c IS NOT NULL;
END $$;

-- ============ VIDEO EVALUATION (hand-labelled 50-game set) ============
CREATE TABLE video_eval_labels (
  game_id                BIGINT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  acceptable_youtube_ids TEXT[] NOT NULL DEFAULT '{}',
  notes                  TEXT,
  labelled_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ RETRIEVAL ============
-- filters (all optional):
--   tags_any text[]        game must have at least one of these tags (boosted by how many match)
--   tags_exclude text[]    game must have none of these
--   coop bool, multiplayer bool, single_player bool
--   max_price_cents int    cheapest current price in p_country across Steam/Epic
--   min_playtime_hrs / max_playtime_hrs numeric
--   release_status text[]  e.g. {released,early_access}
--   exclude_ids bigint[]
CREATE OR REPLACE FUNCTION match_games(
  p_query_emb vector(384),
  p_filters   JSONB,
  p_country   CHAR(2),
  p_user_id   UUID,
  p_limit     INT DEFAULT 5
)
RETURNS TABLE (game_id BIGINT, score REAL, similarity REAL, matched_tags TEXT[], min_price_cents INT)
LANGUAGE sql STABLE AS $$
WITH f AS (
  SELECT
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_filters->'tags_any')), '{}')      AS tags_any,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_filters->'tags_exclude')), '{}')  AS tags_exclude,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_filters->'release_status')), '{}') AS statuses,
    COALESCE(ARRAY(SELECT (jsonb_array_elements_text(p_filters->'exclude_ids'))::bigint), '{}') AS exclude_ids,
    (p_filters->>'coop')::boolean           AS coop,
    (p_filters->>'multiplayer')::boolean    AS multiplayer,
    (p_filters->>'single_player')::boolean  AS single_player,
    (p_filters->>'max_price_cents')::int    AS max_price,
    (p_filters->>'min_playtime_hrs')::numeric AS min_hrs,
    (p_filters->>'max_playtime_hrs')::numeric AS max_hrs
),
prices AS (
  SELECT sl.game_id, MIN(ps.current_cents) AS min_cents
  FROM store_listings sl
  JOIN price_summary ps ON ps.listing_id = sl.id AND ps.country_code = p_country
  GROUP BY sl.game_id
),
gt AS (
  SELECT g2.game_id, array_agg(t.name) AS names
  FROM game_tags g2 JOIN tags t ON t.id = g2.tag_id
  GROUP BY g2.game_id
),
cand AS (
  SELECT g.id, g.popularity,
         CASE WHEN p_query_emb IS NULL OR g.embedding IS NULL THEN 0
              ELSE 1 - (g.embedding <=> p_query_emb) END AS sim,
         COALESCE(gt.names, '{}') AS names,
         pr.min_cents
  FROM games g
  CROSS JOIN f
  LEFT JOIN gt ON gt.game_id = g.id
  LEFT JOIN prices pr ON pr.game_id = g.id
  WHERE NOT (g.id = ANY (f.exclude_ids))
    AND (p_user_id IS NULL OR NOT EXISTS
          (SELECT 1 FROM user_excluded_games x WHERE x.user_id = p_user_id AND x.game_id = g.id))
    AND (cardinality(f.statuses) = 0 OR g.release_status = ANY (f.statuses))
    AND (cardinality(f.tags_any) = 0 OR COALESCE(gt.names, '{}') && f.tags_any)
    AND (cardinality(f.tags_exclude) = 0 OR NOT (COALESCE(gt.names, '{}') && f.tags_exclude))
    AND (f.coop IS NOT TRUE OR g.is_coop)
    AND (f.multiplayer IS NOT TRUE OR g.is_multiplayer)
    AND (f.single_player IS NOT TRUE OR 'Single player' = ANY (COALESCE(gt.names, '{}')))
    AND (f.max_price IS NULL OR pr.min_cents <= f.max_price)
    AND (f.min_hrs IS NULL OR g.avg_playtime_hrs >= f.min_hrs)
    AND (f.max_hrs IS NULL OR g.avg_playtime_hrs <= f.max_hrs)
),
aff AS (
  SELECT c.id, COALESCE(SUM(a.weight), 0) AS boost
  FROM cand c
  JOIN game_tags g2 ON g2.game_id = c.id
  JOIN user_tag_affinity a ON a.tag_id = g2.tag_id AND a.user_id = p_user_id
  GROUP BY c.id
)
SELECT c.id,
       ( 0.60 * c.sim
       + 0.30 * CASE WHEN cardinality(f.tags_any) = 0 THEN 0
                     ELSE cardinality(ARRAY(SELECT unnest(c.names) INTERSECT SELECT unnest(f.tags_any)))::real
                          / cardinality(f.tags_any) END
       + 0.03 * GREATEST(LEAST(COALESCE(aff.boost, 0), 10), -10)
       + 0.05 * LEAST(c.popularity / 1000.0, 1)
       )::real AS score,
       c.sim::real,
       ARRAY(SELECT unnest(c.names) INTERSECT SELECT unnest(f.tags_any)) AS matched_tags,
       c.min_cents
FROM cand c
CROSS JOIN f
LEFT JOIN aff ON aff.id = c.id
ORDER BY score DESC
LIMIT p_limit;
$$;

-- ============ RLS on new tables (server uses the service key) ============
ALTER TABLE rate_limits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_usage_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_eval_labels  ENABLE ROW LEVEL SECURITY;

-- Functions in public are exposed over PostgREST RPC; only the service role may call them.
REVOKE EXECUTE ON FUNCTION hit_rate_limit(TEXT, INT, INT)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION try_consume_llm(TEXT[], INT[], INT)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION try_consume_email(INT)                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION match_games(vector, JSONB, CHAR, UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION handle_new_auth_user()                  FROM PUBLIC, anon, authenticated;

-- Housekeeping addition:
--   DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
