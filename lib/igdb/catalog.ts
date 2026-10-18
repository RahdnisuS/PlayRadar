// Shared by the catalog seed and the Epic free-games job: the IGDB game shape we fetch, store ids, and saving one
// game (row, tags, store listings) exactly the way the seed does.
import type { PoolClient } from "pg";
import { igdb, coverUrl, epicSlugFromUrl, SOURCE_STEAM, SOURCE_EPIC, STATUS_EARLY_ACCESS } from "./client";
import { earlyAccessDate, ENRICH_FIELDS, tagsFromKeywords, usefulKeywords } from "./enrich";

type Named = { id: number; name: string };
export type IgdbGame = {
  id: number;
  name: string;
  slug: string;
  summary?: string;
  first_release_date?: number;
  game_status?: number;
  total_rating_count?: number;
  hypes?: number;
  genres?: Named[];
  themes?: Named[];
  game_modes?: Named[];
  player_perspectives?: Named[];
  multiplayer_modes?: { campaigncoop?: boolean; onlinecoop?: boolean; offlinecoop?: boolean; lancoop?: boolean }[];
  involved_companies?: { company: { name: string }; developer: boolean; publisher: boolean }[];
  cover?: { image_id: string };
  videos?: { video_id: string; name: string }[];
  external_games?: { external_game_source: number; uid: string; url?: string }[];
  keywords?: Named[];
  release_dates?: { date?: number; platform?: number; status?: { name?: string } }[];
};

export const DETAIL_FIELDS = [
  "name", "slug", "summary", "first_release_date", "game_status", "total_rating_count", "hypes",
  "genres.name", "themes.name", "game_modes.name", "player_perspectives.name",
  "multiplayer_modes.campaigncoop", "multiplayer_modes.onlinecoop", "multiplayer_modes.offlinecoop", "multiplayer_modes.lancoop",
  "involved_companies.company.name", "involved_companies.developer", "involved_companies.publisher",
  "cover.image_id", "videos.video_id", "videos.name",
  "external_games.external_game_source", "external_games.uid", "external_games.url",
  ...ENRICH_FIELDS,
].join(",");

/** All candidate store ids. A game can have several Steam apps (e.g. a delisted original plus a re-release). */
export function storeIds(g: IgdbGame) {
  const steamAppIds = [...new Set((g.external_games ?? [])
    .filter((e) => e.external_game_source === SOURCE_STEAM && /^\d+$/.test(e.uid))
    .map((e) => e.uid))];
  const epic = g.external_games?.find((e) => e.external_game_source === SOURCE_EPIC && epicSlugFromUrl(e.url));
  return { steamAppIds, epicSlug: epicSlugFromUrl(epic?.url) };
}

/** released / early_access / upcoming from IGDB's status and first (full) release date. */
export function releaseStatus(g: IgdbGame): "released" | "early_access" | "upcoming" {
  if (g.game_status === STATUS_EARLY_ACCESS) return "early_access";
  return !g.first_release_date || g.first_release_date > Date.now() / 1000 ? "upcoming" : "released";
}

export const MAX_PLAYTIME_HRS = 200;

export async function fetchPlaytimes(ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (let i = 0; i < ids.length; i += 500) {
    // "hastily" is IGDB's main-story time; "normally" includes side content and runs very high.
    const rows = await igdb<{ game_id: number; normally?: number; hastily?: number }>("game_time_to_beats",
      `fields game_id,normally,hastily; where game_id = (${ids.slice(i, i + 500)}); limit 500;`);
    for (const r of rows) {
      const secs = r.hastily ?? r.normally;
      // IGDB's times are community-submitted; live-service games get values like 51,000 h. No main story is that long.
      if (secs && secs <= MAX_PLAYTIME_HRS * 3600) out.set(r.game_id, Math.round((secs / 3600) * 10) / 10);
    }
  }
  return out;
}

/** Bulk store-id -> IsThereAnyDeal id lookup (200 ids per request). Shop ids: Steam 61, Epic 16. */
export async function itadLookup(shopId: number, keys: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < keys.length; i += 200) {
    const r = await fetch(`https://api.isthereanydeal.com/lookup/id/shop/${shopId}/v1?key=${process.env.ITAD_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(keys.slice(i, i + 200)),
    });
    if (!r.ok) throw new Error(`ITAD lookup ${r.status}`);
    Object.assign(out, await r.json());
  }
  return out;
}

const COOP_MODES = new Set(["Co-operative", "Split screen"]);
const MULTI_MODES = new Set(["Multiplayer", "Co-operative", "Split screen", "Massively Multiplayer Online (MMO)", "Battle Royale"]);

export type TagCache = Map<string, number>;

export async function upsertTag(client: PoolClient, name: string, kind: string, cache: TagCache) {
  const key = `${kind}:${name}`;
  if (cache.has(key)) return cache.get(key)!;
  const { rows } = await client.query(
    `INSERT INTO tags (name, kind) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [name, kind]);
  cache.set(key, rows[0].id);
  return rows[0].id as number;
}

export type Resolved = { itadId: string | null; steamAppId: string | null; epicSlug: string | null };

/** Upserts one IGDB game with its tags and store listings. Returns our games.id. */
export async function saveIgdbGame(
  client: PoolClient,
  g: IgdbGame,
  opts: { status: string; popularity: number; playtime: number | null; resolved: Resolved; stores: { steam: number; epic: number }; tagCache: TagCache },
): Promise<string> {
  const modes = (g.game_modes ?? []).map((m) => m.name);
  const coopFlag = (g.multiplayer_modes ?? []).some((m) => m.campaigncoop || m.onlinecoop || m.offlinecoop || m.lancoop);
  const dev = g.involved_companies?.find((c) => c.developer)?.company.name ?? null;
  const pub = g.involved_companies?.find((c) => c.publisher)?.company.name ?? null;
  const videos = (g.videos ?? []).map((v) => ({ id: v.video_id, name: v.name }));
  const { rows } = await client.query(
    `INSERT INTO games (igdb_id, slug, title, summary, release_date, release_status, cover_url, developer, publisher,
                        avg_playtime_hrs, is_multiplayer, is_coop, popularity, external_ids, itad_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
     ON CONFLICT (igdb_id) DO UPDATE SET itad_id=EXCLUDED.itad_id,
       title=EXCLUDED.title, summary=EXCLUDED.summary, release_date=EXCLUDED.release_date,
       release_status=EXCLUDED.release_status, cover_url=EXCLUDED.cover_url, developer=EXCLUDED.developer,
       publisher=EXCLUDED.publisher, avg_playtime_hrs=EXCLUDED.avg_playtime_hrs,
       is_multiplayer=EXCLUDED.is_multiplayer, is_coop=EXCLUDED.is_coop, popularity=EXCLUDED.popularity,
       external_ids = games.external_ids || EXCLUDED.external_ids, updated_at=now()
     RETURNING id`,
    [
      g.id, g.slug, g.name, g.summary ?? null,
      g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
      opts.status, g.cover ? coverUrl(g.cover.image_id) : null, dev, pub,
      opts.playtime,
      modes.some((m) => MULTI_MODES.has(m)) || coopFlag,
      modes.some((m) => COOP_MODES.has(m)) || coopFlag,
      opts.popularity,
      JSON.stringify({ igdb_videos: videos }),
      opts.resolved.itadId,
    ]);
  const gameId = String(rows[0].id);

  const tagIds = new Set<number>();
  for (const t of g.genres ?? []) tagIds.add(await upsertTag(client, t.name, "genre", opts.tagCache));
  for (const t of g.themes ?? []) tagIds.add(await upsertTag(client, t.name, "theme", opts.tagCache));
  for (const t of g.game_modes ?? []) tagIds.add(await upsertTag(client, t.name, "mechanic", opts.tagCache));
  for (const t of g.player_perspectives ?? []) tagIds.add(await upsertTag(client, t.name, "mechanic", opts.tagCache));
  const keywords = (g.keywords ?? []).map((k) => k.name);
  for (const t of tagsFromKeywords(keywords)) tagIds.add(await upsertTag(client, t.name, t.kind, opts.tagCache));
  await client.query(
    `UPDATE games SET early_access_date = $2, external_ids = external_ids || jsonb_build_object('igdb_keywords', $3::jsonb)
     WHERE id = $1`,
    [gameId, earlyAccessDate(g.release_dates, g.first_release_date), JSON.stringify(usefulKeywords(keywords, 20))],
  );
  for (const tagId of tagIds) {
    await client.query(`INSERT INTO game_tags (game_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [gameId, tagId]);
  }

  const { steamAppId, epicSlug } = opts.resolved;
  if (steamAppId) {
    await client.query(
      `INSERT INTO store_listings (game_id, store_id, store_app_id, store_url, steam_app_link)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [gameId, opts.stores.steam, steamAppId, `https://store.steampowered.com/app/${steamAppId}/`, `steam://store/${steamAppId}`]);
  }
  if (epicSlug) {
    await client.query(
      `INSERT INTO store_listings (game_id, store_id, store_app_id, store_url)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [gameId, opts.stores.epic, epicSlug, `https://store.epicgames.com/p/${epicSlug}`]);
  }
  return gameId;
}
