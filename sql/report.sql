-- PlayRadar results report. Paste into the Supabase SQL editor (or psql) and run; every query is read-only.
-- The /metrics page shows the same numbers (lib/metrics.ts).

-- 1. How chat messages were answered (source is NULL on turns from before 2026-10-18, shown as 'unknown').
SELECT COALESCE(source, 'unknown') AS source, count(*) AS turns,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct,
       count(*) FILTER (WHERE created_at > now() - interval '7 days') AS last_7_days
FROM chat_messages WHERE role = 'user'
GROUP BY 1 ORDER BY 2 DESC;

-- 2. LLM vs fallback vs cache per day (typed messages only, since tracking began).
SELECT created_at::date AS day,
       count(*) FILTER (WHERE source = 'llm') AS llm,
       count(*) FILTER (WHERE source = 'fallback') AS fallback,
       count(*) FILTER (WHERE source IN ('cache_exact', 'cache_similar')) AS cache,
       round(100.0 * count(*) FILTER (WHERE source IN ('cache_exact', 'cache_similar')) / NULLIF(count(*), 0), 1) AS cache_hit_pct
FROM chat_messages WHERE role = 'user' AND source IN ('llm', 'fallback', 'cache_exact', 'cache_similar')
GROUP BY 1 ORDER BY 1 DESC;

-- 3. Click-through rate: share of shown games with a video play, "looks good", wishlist or store click.
WITH r AS (
  SELECT r.id, r.rank,
         bool_or(e.event_type IN ('video_played', 'liked', 'wishlisted', 'store_click')) AS engaged
  FROM recommendations r LEFT JOIN recommendation_events e ON e.recommendation_id = r.id
  GROUP BY r.id, r.rank
)
SELECT COALESCE(rank::text, 'all') AS rank, count(*) AS shown, count(*) FILTER (WHERE engaged) AS engaged,
       round(100.0 * count(*) FILTER (WHERE engaged) / NULLIF(count(*), 0), 1) AS ctr_pct
FROM r GROUP BY ROLLUP (rank) ORDER BY rank NULLS FIRST;

-- 4. Share of shown games with each action.
SELECT e.event_type, count(DISTINCT e.recommendation_id) AS games,
       round(100.0 * count(DISTINCT e.recommendation_id) / NULLIF((SELECT count(*) FROM recommendations), 0), 1) AS pct_of_shown
FROM recommendation_events e GROUP BY 1 ORDER BY 2 DESC;

-- 5. Video accuracy against the hand-labelled set.
SELECT count(*) AS labelled, count(v.id) AS with_video,
       count(*) FILTER (WHERE v.youtube_id = ANY (l.acceptable_youtube_ids)) AS correct,
       round(100.0 * count(*) FILTER (WHERE v.youtube_id = ANY (l.acceptable_youtube_ids)) / NULLIF(count(*), 0), 1) AS accuracy_pct
FROM video_eval_labels l LEFT JOIN videos v ON v.game_id = l.game_id AND v.is_selected;

-- 5b. Labelled games whose selected video was judged wrong.
SELECT g.title, v.youtube_id, v.title AS video_title, v.kind, v.classified_by, l.notes
FROM video_eval_labels l JOIN games g ON g.id = l.game_id
LEFT JOIN videos v ON v.game_id = l.game_id AND v.is_selected
WHERE v.youtube_id IS NULL OR NOT (v.youtube_id = ANY (l.acceptable_youtube_ids))
ORDER BY g.popularity DESC;

-- 6. Selected videos by type and how they were judged.
SELECT kind, COALESCE(classified_by, 'rules') AS classified_by, count(*)
FROM videos WHERE is_selected GROUP BY 1, 2 ORDER BY 3 DESC;

-- 7. Alerts by type and outcome.
SELECT type, status, count(*) FROM notifications GROUP BY 1, 2 ORDER BY 1, 2;

-- 8. Free-tier usage over the last 14 days.
SELECT day, scope_key, calls FROM llm_usage_daily
WHERE day > current_date - 14 AND (scope_key LIKE 'global:%' OR scope_key = 'youtube:units')
ORDER BY day DESC, scope_key;
