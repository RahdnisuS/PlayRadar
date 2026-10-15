// Runs match_games and loads what the result cards need. If strict filters return too few games,
// relaxes them step by step (never relaxing price, exclusions or release status) and says so.
import { q } from "../db";
import type { Filters } from "./filters";
import { toPgVector } from "./embed";

export type ResultGame = {
  id: string;
  slug: string;
  title: string;
  cover_url: string | null;
  summary: string | null;
  release_status: string;
  release_date: string | null;
  is_coop: boolean | null;
  avg_playtime_hrs: number | null;
  tags: string[];
  moods: string[];
  matched_tags: string[];
  score: number;
  price_cents: number | null;
  regular_cents: number | null;
  lowest_cents: number | null;
  currency: string | null;
  stores: { shop: "steam" | "epic"; url: string; app_link: string | null }[];
  /** Already-selected video, if this game has one cached (free to show; selection happens on demand). */
  video_youtube_id: string | null;
};

type MatchRow = { game_id: string; score: number; matched_tags: string[] };

async function match(filters: Filters, emb: number[] | null, country: string, userId: string | null, limit: number) {
  return q<MatchRow>(`SELECT game_id, score, matched_tags FROM match_games($1::vector, $2::jsonb, $3, $4::uuid, $5)`, [
    toPgVector(emb), JSON.stringify(filters), country, userId, limit,
  ]);
}

export async function loadGames(ids: string[], country: string): Promise<Omit<ResultGame, "matched_tags" | "score">[]> {
  if (!ids.length) return [];
  return q(
    `SELECT g.id, g.slug, g.title, g.cover_url, g.summary, g.release_status, g.release_date::text, g.is_coop,
            g.avg_playtime_hrs::float AS avg_playtime_hrs,
            COALESCE(array_agg(t.name ORDER BY t.kind, t.name) FILTER (WHERE t.kind <> 'mood'), '{}') AS tags,
            COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.kind = 'mood'), '{}') AS moods,
            p.current_cents AS price_cents, p.regular_cents, p.lowest_cents, p.currency,
            (SELECT COALESCE(json_agg(json_build_object('shop', s.code, 'url', sl.store_url, 'app_link', sl.steam_app_link)
                                      ORDER BY s.code DESC), '[]')
             FROM store_listings sl JOIN stores s ON s.id = sl.store_id WHERE sl.game_id = g.id) AS stores,
            (SELECT v.youtube_id FROM videos v WHERE v.game_id = g.id AND v.is_selected AND v.status = 'ok') AS video_youtube_id
     FROM games g
     LEFT JOIN game_tags gt ON gt.game_id = g.id
     LEFT JOIN tags t ON t.id = gt.tag_id
     LEFT JOIN LATERAL (
       SELECT ps.current_cents, ps.lowest_cents, s.regular_cents, s.currency
       FROM store_listings sl
       JOIN price_summary ps ON ps.listing_id = sl.id AND ps.country_code = $2
       LEFT JOIN LATERAL (SELECT regular_cents, currency FROM price_snapshots
                          WHERE listing_id = sl.id AND country_code = $2 ORDER BY captured_at DESC LIMIT 1) s ON true
       WHERE sl.game_id = g.id ORDER BY ps.current_cents LIMIT 1
     ) p ON true
     WHERE g.id = ANY($1::bigint[])
     GROUP BY g.id, p.current_cents, p.regular_cents, p.lowest_cents, p.currency`,
    [ids, country],
  );
}

export async function retrieve(
  filters: Filters,
  emb: number[] | null,
  country: string,
  userId: string | null,
  limit = 5,
): Promise<{ games: ResultGame[]; relaxed: string | null }> {
  const steps: [Filters, string | null][] = [
    [filters, null],
    [{ ...filters, min_playtime_hrs: undefined, max_playtime_hrs: undefined }, "ignored the playtime limit"],
    [{ ...filters, min_playtime_hrs: undefined, max_playtime_hrs: undefined, tags_any: [] }, "loosened the genre/mood match"],
    [{ ...filters, min_playtime_hrs: undefined, max_playtime_hrs: undefined, tags_any: [], coop: undefined, multiplayer: undefined, single_player: undefined }, "dropped the player-mode requirement"],
  ];
  let rows: MatchRow[] = [];
  let relaxed: string | null = null;
  for (const [f, note] of steps) {
    rows = await match(f, emb, country, userId, limit);
    relaxed = note;
    if (rows.length >= limit) break;
  }
  if (rows.length === 0) relaxed = null;
  const details = new Map((await loadGames(rows.map((r) => r.game_id), country)).map((g) => [String(g.id), g]));
  const games = rows
    .map((r) => {
      const d = details.get(String(r.game_id));
      return d ? { ...d, id: String(d.id), score: r.score, matched_tags: r.matched_tags ?? [] } : null;
    })
    .filter((g): g is ResultGame => g !== null);
  return { games, relaxed };
}
