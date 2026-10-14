-- PlayRadar schema v3 (PostgreSQL + pgvector) -- schema_v2 with all fixes merged in.
-- Notes:
--  * users.id is UUID so it works with Supabase Auth (set it to REFERENCES auth.users(id) if you use it)
--    and with any other auth setup.
--  * Embedding size is 384; change vector(384) if your embedding model uses a different dimension.
--  * Use a migration tool (Supabase migrations, Drizzle, or Prisma) rather than running this file by hand.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============ REGIONS (short, fixed list) ============
CREATE TABLE regions (
  country_code CHAR(2) PRIMARY KEY,
  currency     CHAR(3) NOT NULL,
  label        TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO regions (country_code, currency, label) VALUES
  ('IN','INR','India'), ('US','USD','United States'),
  ('GB','GBP','United Kingdom'), ('DE','EUR','Europe (EUR)');
-- Currencies here all use 2 decimal places. If you add one with none (e.g. JPY), handle minor units explicitly.

-- ============ USERS ============
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- or REFERENCES auth.users(id) on Supabase
  email             CITEXT UNIQUE NOT NULL,
  display_name      TEXT,
  country_code      CHAR(2) NOT NULL DEFAULT 'IN' REFERENCES regions(country_code),
  email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  email_digest      TEXT NOT NULL DEFAULT 'instant'
                    CHECK (email_digest IN ('instant','daily','weekly','off')),
  free_game_alerts  BOOLEAN NOT NULL DEFAULT FALSE,
  unsubscribe_token TEXT UNIQUE DEFAULT gen_random_uuid()::text,  -- one-click unsubscribe link in every email
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ GAME CATALOG ============
-- Only include games that are actually sold on Steam or Epic.
CREATE TABLE games (
  id               BIGSERIAL PRIMARY KEY,
  igdb_id          BIGINT UNIQUE,              -- or a RAWG id if you use RAWG
  itad_id          TEXT UNIQUE,                -- IsThereAnyDeal's own game id
  external_ids     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- other provider ids
  slug             TEXT UNIQUE NOT NULL,
  title            TEXT NOT NULL,
  summary          TEXT,
  release_date     DATE,
  release_status   TEXT NOT NULL CHECK (release_status IN ('released','upcoming','early_access')),
  cover_url        TEXT,
  developer        TEXT,
  publisher        TEXT,
  avg_playtime_hrs NUMERIC(6,1),
  is_multiplayer   BOOLEAN,
  is_coop          BOOLEAN,
  embedding        vector(384),
  embedding_model  TEXT,                       -- which model produced the embedding (re-embed if it changes)
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX games_embedding_idx ON games USING hnsw (embedding vector_cosine_ops);
CREATE INDEX games_release_idx ON games (release_status, release_date);

CREATE TABLE tags (
  id    SERIAL PRIMARY KEY,
  name  TEXT UNIQUE NOT NULL,
  kind  TEXT NOT NULL CHECK (kind IN ('genre','theme','mood','mechanic'))
);
-- Genres and themes come from the metadata source; 'mood' tags (cozy, dark, relaxing...) must be
-- generated once by the LLM at seed time, otherwise that kind stays empty.
CREATE TABLE game_tags (
  game_id BIGINT REFERENCES games(id) ON DELETE CASCADE,
  tag_id  INT    REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (game_id, tag_id)
);

-- ============ STORES + LISTINGS (Steam and Epic only) ============
CREATE TABLE stores (
  id    SMALLSERIAL PRIMARY KEY,
  code  TEXT UNIQUE NOT NULL CHECK (code IN ('steam','epic')),
  name  TEXT NOT NULL
);
INSERT INTO stores (code, name) VALUES ('steam','Steam'), ('epic','Epic Games Store');

-- Importer should pick the base edition and skip DLC, demos, and bundles.
CREATE TABLE store_listings (
  id             BIGSERIAL PRIMARY KEY,
  game_id        BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  store_id       SMALLINT NOT NULL REFERENCES stores(id),
  store_app_id   TEXT NOT NULL,                -- Steam appid / Epic slug
  store_url      TEXT NOT NULL,                -- normal https link (always works)
  steam_app_link TEXT,                         -- steam://store/<appid>, Steam rows only
  UNIQUE (store_id, store_app_id),
  UNIQUE (game_id, store_id)
);

-- ============ PRICES ============
CREATE TABLE price_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  listing_id    BIGINT NOT NULL REFERENCES store_listings(id) ON DELETE CASCADE,
  country_code  CHAR(2) NOT NULL REFERENCES regions(country_code),
  currency      CHAR(3) NOT NULL,              -- native currency as returned by the source, never converted
  price_cents   INT NOT NULL,
  regular_cents INT NOT NULL,
  discount_pct  SMALLINT GENERATED ALWAYS AS
                  (CASE WHEN regular_cents > 0
                        THEN ((regular_cents - price_cents) * 100 / regular_cents)
                        ELSE 0 END) STORED,
  sale_ends_at  TIMESTAMPTZ,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX price_lookup_idx ON price_snapshots (listing_id, country_code, captured_at DESC);
-- Insert a new row only when the price changes (price_fetch_state records when it was last checked).

CREATE TABLE price_summary (
  listing_id     BIGINT NOT NULL REFERENCES store_listings(id) ON DELETE CASCADE,
  country_code   CHAR(2) NOT NULL REFERENCES regions(country_code),
  current_cents  INT NOT NULL,
  lowest_cents   INT NOT NULL,                 -- seed from the provider's historical low if it offers one
  lowest_at      TIMESTAMPTZ,
  sale_count_12m SMALLINT DEFAULT 0,
  tracking_since TIMESTAMPTZ,                  -- tells the UI how much history exists
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, country_code)
);
CREATE INDEX price_summary_budget_idx ON price_summary (country_code, current_cents);   -- budget filter
-- Bulk-fetch default-region (IN) prices for the whole seeded catalog and refresh daily, so budget filters work.
-- Other regions: fetch on demand and cache using price_fetch_state.

CREATE TABLE price_fetch_state (
  listing_id      BIGINT NOT NULL REFERENCES store_listings(id) ON DELETE CASCADE,
  country_code    CHAR(2) NOT NULL REFERENCES regions(country_code),
  last_fetched_at TIMESTAMPTZ NOT NULL,
  last_status     TEXT NOT NULL DEFAULT 'ok' CHECK (last_status IN ('ok','error','not_listed')),
  PRIMARY KEY (listing_id, country_code)
);
-- Scheduled polling set = wishlist_items JOIN users.country_code JOIN store_listings.

-- ============ FREE PROMOTIONS (Epic free games) ============
CREATE TABLE free_promotions (
  id         BIGSERIAL PRIMARY KEY,
  game_id    BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  store_id   SMALLINT NOT NULL REFERENCES stores(id),
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL,
  UNIQUE (game_id, store_id, starts_at)
);

-- ============ VIDEOS ============
CREATE TABLE videos (
  id               BIGSERIAL PRIMARY KEY,
  game_id          BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  youtube_id       TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('gameplay_overview','trailer','gameplay_trailer')),
  title            TEXT,
  channel_title    TEXT,
  duration_sec     INT,
  spoiler_risk     REAL,                       -- 0..1
  classified_by    TEXT CHECK (classified_by IN ('rules','llm','human')),
  quality_score    REAL,
  is_selected      BOOLEAN NOT NULL DEFAULT FALSE,
  is_embeddable    BOOLEAN NOT NULL DEFAULT TRUE,
  status           TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','removed','blocked')),
  human_verified   BOOLEAN NOT NULL DEFAULT FALSE,   -- your 50-game evaluation set
  last_verified_at TIMESTAMPTZ,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, youtube_id)
);
CREATE UNIQUE INDEX videos_one_selected_idx ON videos (game_id) WHERE is_selected;
-- Classify each game's video once and cache it here. Re-check removed or blocked videos on a schedule,
-- and swap an upcoming game's trailer for a gameplay overview after it releases.

-- ============ CHAT, CACHE, USAGE CAPS ============
CREATE TABLE chat_sessions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_token TEXT,
  state       TEXT NOT NULL DEFAULT 'discovering'
              CHECK (state IN ('discovering','showing_results','watching','buy_prompt','wishlist_prompt','done')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_sessions_guest_idx ON chat_sessions (guest_token);

CREATE TABLE chat_messages (
  id                BIGSERIAL PRIMARY KEY,
  session_id        BIGINT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content           TEXT NOT NULL,
  extracted_filters JSONB,
  used_llm          BOOLEAN NOT NULL DEFAULT TRUE,   -- false when the fallback path answered
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_session_idx ON chat_messages (session_id, created_at);

CREATE TABLE chat_cache (
  query_hash   TEXT PRIMARY KEY,               -- hash of normalized message + filters + region
  country_code CHAR(2),                        -- results depend on prices, so cache per region
  filters      JSONB NOT NULL,
  game_ids     BIGINT[] NOT NULL,
  reasons      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 day'
);

CREATE TABLE llm_usage_daily (
  day        DATE NOT NULL,
  scope_key  TEXT NOT NULL,                    -- 'global', 'user:<id>', or 'guest:<token>'
  calls      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, scope_key)
);

-- ============ RECOMMENDATIONS + FEEDBACK ============
CREATE TABLE recommendations (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  game_id      BIGINT NOT NULL REFERENCES games(id),
  rank         SMALLINT NOT NULL,
  match_score  REAL,
  reason       TEXT,
  video_id     BIGINT REFERENCES videos(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX recommendations_session_idx ON recommendations (session_id);

CREATE TABLE recommendation_events (
  id                BIGSERIAL PRIMARY KEY,
  recommendation_id BIGINT NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL CHECK (event_type IN
                    ('video_played','video_finished','liked','disliked',
                     'wishlisted','store_click','not_interested')),
  store_id          SMALLINT REFERENCES stores(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX recommendation_events_rec_idx ON recommendation_events (recommendation_id);

CREATE TABLE user_tag_affinity (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id     INT  NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  weight     REAL NOT NULL DEFAULT 0,          -- + liked/wishlisted/finished, - disliked/not_interested
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tag_id)
);

CREATE TABLE user_excluded_games (
  user_id UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, game_id)
);

-- ============ WISHLIST + ALERTS ============
CREATE TABLE wishlist_items (
  user_id               UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id               BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  target_price_cents    INT,
  target_currency       CHAR(3),               -- set together with target_price_cents
  alert_on_any_sale     BOOLEAN NOT NULL DEFAULT TRUE,
  alert_on_all_time_low BOOLEAN NOT NULL DEFAULT TRUE,
  alert_on_release      BOOLEAN NOT NULL DEFAULT TRUE,
  source                TEXT NOT NULL DEFAULT 'site' CHECK (source IN ('site','chat')),
  added_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);
CREATE INDEX wishlist_game_idx ON wishlist_items (game_id);   -- "who wishlisted game X?" when a price changes

CREATE TABLE notifications (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id      BIGINT NOT NULL REFERENCES games(id),
  snapshot_id  BIGINT REFERENCES price_snapshots(id),     -- exact price shown in the email
  promo_id     BIGINT REFERENCES free_promotions(id),     -- for free_to_claim
  type         TEXT NOT NULL CHECK (type IN ('sale','all_time_low','target_hit','released','free_to_claim')),
  dedupe_key   TEXT NOT NULL,                  -- e.g. user:game:store:country:sale_end
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at      TIMESTAMPTZ,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_queue_idx ON notifications (status, created_at);

-- ============ SECURITY (Supabase) ============
-- Deny all direct client access by default; the server uses the service key.
-- Add explicit policies only for data users should read or write directly.
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- ============ HOUSEKEEPING (schedule these; free-tier storage is limited) ============
--   DELETE FROM chat_sessions WHERE user_id IS NULL AND started_at < now() - interval '30 days';
--   DELETE FROM chat_cache WHERE expires_at < now();
--   DELETE FROM llm_usage_daily WHERE day < current_date - 30;
