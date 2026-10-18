// Aggregate numbers for the public /metrics page. Only counts and rates, never messages or user data.
// sql/report.sql has the same queries for running by hand in the Supabase SQL editor.
import { q } from "./db";
import { GLOBAL_CAPS } from "./llm/caps";
import { YOUTUBE_DAILY_UNITS } from "./video/youtube";

export const EVENT_TYPES = ["video_played", "video_finished", "liked", "wishlisted", "store_click", "not_interested"] as const;
type EventType = (typeof EVENT_TYPES)[number];

export type Metrics = {
  since: string | null;
  turns: { source: string; total: number; week: number }[];
  recs: { shown: number; engaged: number; byEvent: Record<EventType, number> };
  byRank: { rank: number; shown: number; engaged: number }[];
  afterVideo: { played: number; good: number; notForMe: number };
  videos: { kind: string; classifiedBy: string; n: number }[];
  eval: { labelled: number; withVideo: number; correct: number };
  today: { label: string; used: number; cap: number }[];
  alerts: { type: string; sent: number; dropped: number; queued: number }[];
  catalog: { games: number; priced: number; videos: number };
};

// A recommendation counts as engaged when the user did something that shows interest in the game.
const ENGAGED: EventType[] = ["video_played", "liked", "wishlisted", "store_click"];

export async function getMetrics(): Promise<Metrics> {
  const [since] = await q<{ since: string | null }>(`SELECT min(created_at)::text AS since FROM chat_messages`);

  const turns = await q<{ source: string; total: number; week: number }>(
    `SELECT COALESCE(source, 'unknown') AS source, count(*)::int AS total,
            count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week
     FROM chat_messages WHERE role = 'user' GROUP BY 1 ORDER BY 2 DESC`,
  );

  const per = await q<{ rank: number; events: EventType[] }>(
    `SELECT r.rank, COALESCE(array_agg(DISTINCT e.event_type) FILTER (WHERE e.id IS NOT NULL), '{}') AS events
     FROM recommendations r LEFT JOIN recommendation_events e ON e.recommendation_id = r.id
     GROUP BY r.id, r.rank`,
  );
  const byEvent = Object.fromEntries(EVENT_TYPES.map((t) => [t, 0])) as Record<EventType, number>;
  const ranks = new Map<number, { shown: number; engaged: number }>();
  const afterVideo = { played: 0, good: 0, notForMe: 0 };
  let engaged = 0;
  for (const r of per) {
    const ev = new Set(r.events);
    for (const t of EVENT_TYPES) if (ev.has(t)) byEvent[t]++;
    const isEngaged = ENGAGED.some((t) => ev.has(t));
    if (isEngaged) engaged++;
    const rk = ranks.get(r.rank) ?? { shown: 0, engaged: 0 };
    rk.shown++;
    if (isEngaged) rk.engaged++;
    ranks.set(r.rank, rk);
    if (ev.has("video_played")) {
      afterVideo.played++;
      if (ev.has("liked") || ev.has("wishlisted")) afterVideo.good++;
      else if (ev.has("not_interested")) afterVideo.notForMe++;
    }
  }

  const videos = await q<{ kind: string; classifiedBy: string; n: number }>(
    `SELECT kind, COALESCE(classified_by, 'rules') AS "classifiedBy", count(*)::int AS n
     FROM videos WHERE is_selected GROUP BY 1, 2 ORDER BY 3 DESC`,
  );

  const [ev] = await q<Metrics["eval"]>(
    `SELECT count(*)::int AS labelled, count(v.id)::int AS "withVideo",
            count(*) FILTER (WHERE v.youtube_id = ANY (l.acceptable_youtube_ids))::int AS correct
     FROM video_eval_labels l LEFT JOIN videos v ON v.game_id = l.game_id AND v.is_selected`,
  );

  const usage = new Map(
    (await q<{ scope_key: string; calls: number }>(
      `SELECT scope_key, calls FROM llm_usage_daily
       WHERE day = current_date AND (scope_key LIKE 'global:%' OR scope_key = 'youtube:units')`,
    )).map((r) => [r.scope_key, r.calls]),
  );
  const [email] = await q<{ sent: number }>(`SELECT COALESCE(max(sent), 0)::int AS sent FROM email_usage_daily WHERE day = current_date`);
  const today = [
    { label: "LLM filter calls", used: usage.get("global:filters") ?? 0, cap: GLOBAL_CAPS.filters },
    { label: "LLM explanation calls", used: usage.get("global:explain") ?? 0, cap: GLOBAL_CAPS.explain },
    { label: "LLM heavy calls", used: usage.get("global:heavy") ?? 0, cap: GLOBAL_CAPS.heavy },
    { label: "YouTube API units", used: usage.get("youtube:units") ?? 0, cap: YOUTUBE_DAILY_UNITS },
    { label: "Alert emails", used: email?.sent ?? 0, cap: 200 },
  ];

  const alerts = await q<Metrics["alerts"][number]>(
    `SELECT type, count(*) FILTER (WHERE status = 'sent')::int AS sent,
            count(*) FILTER (WHERE status = 'failed')::int AS dropped,
            count(*) FILTER (WHERE status = 'queued')::int AS queued
     FROM notifications GROUP BY 1 ORDER BY 2 DESC`,
  );

  const [catalog] = await q<Metrics["catalog"]>(
    `SELECT (SELECT count(*) FROM games)::int AS games,
            (SELECT count(DISTINCT sl.game_id) FROM store_listings sl JOIN price_summary ps ON ps.listing_id = sl.id)::int AS priced,
            (SELECT count(*) FROM videos WHERE is_selected)::int AS videos`,
  );

  return {
    since: since?.since ?? null,
    turns,
    recs: { shown: per.length, engaged, byEvent },
    byRank: [...ranks].map(([rank, v]) => ({ rank, ...v })).sort((a, b) => a.rank - b.rank),
    afterVideo,
    videos,
    eval: ev,
    today,
    alerts,
    catalog,
  };
}
