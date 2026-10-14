// Seeds ~2,000 games from IGDB: popular released PC games plus the most-wishlisted upcoming ones,
// each sold on Steam and/or Epic. Re-runnable: everything upserts on igdb_id / unique keys.
// Usage: npx tsx scripts/seed-igdb.ts [--released 1700] [--upcoming 300]
import "./env";
import { q, tx, closeDb } from "./db";
import {
  igdb, coverUrl, epicSlugFromUrl,
  SOURCE_STEAM, SOURCE_EPIC, GAME_TYPES_BASE, STATUS_EARLY_ACCESS, STATUSES_SKIP,
  POP_STEAM_MOST_WISHLISTED_UPCOMING,
} from "../lib/igdb/client";

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const RELEASED_TARGET = arg("released", 1700);
const UPCOMING_TARGET = arg("upcoming", 300);

type Named = { id: number; name: string };
type IgdbGame = {
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
};

const DETAIL_FIELDS = [
  "name", "slug", "summary", "first_release_date", "game_status", "total_rating_count", "hypes",
  "genres.name", "themes.name", "game_modes.name", "player_perspectives.name",
  "multiplayer_modes.campaigncoop", "multiplayer_modes.onlinecoop", "multiplayer_modes.offlinecoop", "multiplayer_modes.lancoop",
  "involved_companies.company.name", "involved_companies.developer", "involved_companies.publisher",
  "cover.image_id", "videos.video_id", "videos.name",
  "external_games.external_game_source", "external_games.uid", "external_games.url",
].join(",");

const BASE_WHERE = `platforms = (6) & game_type = (${GAME_TYPES_BASE}) & game_status != (${STATUSES_SKIP})`;
const STORE_WHERE = `external_games.external_game_source = (${SOURCE_STEAM},${SOURCE_EPIC})`;

function storeIds(g: IgdbGame) {
  const steam = g.external_games?.find((e) => e.external_game_source === SOURCE_STEAM && /^\d+$/.test(e.uid));
  const epic = g.external_games?.find((e) => e.external_game_source === SOURCE_EPIC && epicSlugFromUrl(e.url));
  return { steamAppId: steam?.uid ?? null, epicSlug: epicSlugFromUrl(epic?.url) };
}

async function fetchReleasedSince(since: number, target: number, skip: Set<number>): Promise<IgdbGame[]> {
  const now = Math.floor(Date.now() / 1000);
  const out: IgdbGame[] = [];
  for (let offset = 0; out.length < target && offset < 5000; offset += 500) {
    const page = await igdb<IgdbGame>("games",
      `fields ${DETAIL_FIELDS}; where ${BASE_WHERE} & ${STORE_WHERE} & first_release_date < ${now}` +
      ` & first_release_date >= ${since} & total_rating_count > 0; sort total_rating_count desc; limit 500; offset ${offset};`);
    if (page.length === 0) break;
    for (const g of page) {
      const s = storeIds(g);
      if ((s.steamAppId || s.epicSlug) && !skip.has(g.id)) out.push(g);
    }
  }
  return out.slice(0, target);
}

/** All-time most-rated games, topped up with the most-rated games of the last 3 years so the mix isn't all classics. */
async function fetchReleased(): Promise<IgdbGame[]> {
  const recentTarget = Math.round(RELEASED_TARGET * 0.3);
  const allTime = await fetchReleasedSince(0, RELEASED_TARGET - recentTarget, new Set());
  const threeYearsAgo = Math.floor(Date.now() / 1000) - 3 * 365 * 86400;
  const recent = await fetchReleasedSince(threeYearsAgo, recentTarget, new Set(allTime.map((g) => g.id)));
  console.log(`  released: ${allTime.length} all-time + ${recent.length} recent`);
  // Interleave so rank-based popularity treats both lists fairly.
  const out: IgdbGame[] = [];
  for (let i = 0; i < Math.max(allTime.length, recent.length); i++) {
    if (allTime[i]) out.push(allTime[i]);
    if (recent[i]) out.push(recent[i]);
  }
  return out;
}

async function fetchUpcoming(): Promise<IgdbGame[]> {
  // Steam's "most wishlisted upcoming" ranking, exposed by IGDB as a popularity primitive.
  const prims = await igdb<{ game_id: number; value: number }>("popularity_primitives",
    `fields game_id,value; where popularity_type = ${POP_STEAM_MOST_WISHLISTED_UPCOMING}; sort value desc; limit 500;`);
  const rank = new Map(prims.map((p, i) => [p.game_id, i]));
  const out: IgdbGame[] = [];
  for (let i = 0; i < prims.length; i += 500) {
    const ids = prims.slice(i, i + 500).map((p) => p.game_id);
    const page = await igdb<IgdbGame>("games", `fields ${DETAIL_FIELDS}; where id = (${ids}) & ${BASE_WHERE}; limit 500;`);
    const now = Date.now() / 1000;
    for (const g of page) {
      const notOut = !g.first_release_date || g.first_release_date > now;
      const s = storeIds(g);
      if (notOut && g.game_status !== 0 && (s.steamAppId || s.epicSlug)) out.push(g);
    }
  }
  out.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  console.log(`  upcoming: ${out.length}`);
  return out.slice(0, UPCOMING_TARGET);
}

async function fetchPlaytimes(ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (let i = 0; i < ids.length; i += 500) {
    // "hastily" is IGDB's main-story time; "normally" includes side content and runs very high.
    const rows = await igdb<{ game_id: number; normally?: number; hastily?: number }>("game_time_to_beats",
      `fields game_id,normally,hastily; where game_id = (${ids.slice(i, i + 500)}); limit 500;`);
    for (const r of rows) {
      const secs = r.hastily ?? r.normally;
      if (secs) out.set(r.game_id, Math.round((secs / 3600) * 10) / 10);
    }
  }
  return out;
}

const COOP_MODES = new Set(["Co-operative", "Split screen"]);
const MULTI_MODES = new Set(["Multiplayer", "Co-operative", "Split screen", "Massively Multiplayer Online (MMO)", "Battle Royale"]);

async function upsertTag(client: import("pg").PoolClient, name: string, kind: string, cache: Map<string, number>) {
  const key = `${kind}:${name}`;
  if (cache.has(key)) return cache.get(key)!;
  const { rows } = await client.query(
    `INSERT INTO tags (name, kind) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [name, kind]);
  cache.set(key, rows[0].id);
  return rows[0].id as number;
}

async function save(games: { g: IgdbGame; status: string; popularity: number }[], playtimes: Map<number, number>) {
  const tagCache = new Map<string, number>();
  const [{ id: steamStore }] = await q(`SELECT id FROM stores WHERE code='steam'`);
  const [{ id: epicStore }] = await q(`SELECT id FROM stores WHERE code='epic'`);
  let n = 0;
  await tx(async (client) => {
    for (const { g, status, popularity } of games) {
      const modes = (g.game_modes ?? []).map((m) => m.name);
      const coopFlag = (g.multiplayer_modes ?? []).some((m) => m.campaigncoop || m.onlinecoop || m.offlinecoop || m.lancoop);
      const dev = g.involved_companies?.find((c) => c.developer)?.company.name ?? null;
      const pub = g.involved_companies?.find((c) => c.publisher)?.company.name ?? null;
      const videos = (g.videos ?? []).map((v) => ({ id: v.video_id, name: v.name }));
      const { rows } = await client.query(
        `INSERT INTO games (igdb_id, slug, title, summary, release_date, release_status, cover_url, developer, publisher,
                            avg_playtime_hrs, is_multiplayer, is_coop, popularity, external_ids, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
         ON CONFLICT (igdb_id) DO UPDATE SET
           title=EXCLUDED.title, summary=EXCLUDED.summary, release_date=EXCLUDED.release_date,
           release_status=EXCLUDED.release_status, cover_url=EXCLUDED.cover_url, developer=EXCLUDED.developer,
           publisher=EXCLUDED.publisher, avg_playtime_hrs=EXCLUDED.avg_playtime_hrs,
           is_multiplayer=EXCLUDED.is_multiplayer, is_coop=EXCLUDED.is_coop, popularity=EXCLUDED.popularity,
           external_ids = games.external_ids || EXCLUDED.external_ids, updated_at=now()
         RETURNING id`,
        [
          g.id, g.slug, g.name, g.summary ?? null,
          g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
          status, g.cover ? coverUrl(g.cover.image_id) : null, dev, pub,
          playtimes.get(g.id) ?? null,
          modes.some((m) => MULTI_MODES.has(m)) || coopFlag,
          modes.some((m) => COOP_MODES.has(m)) || coopFlag,
          popularity,
          JSON.stringify({ igdb_videos: videos }),
        ]);
      const gameId = rows[0].id;

      const tagIds = new Set<number>();
      for (const t of g.genres ?? []) tagIds.add(await upsertTag(client, t.name, "genre", tagCache));
      for (const t of g.themes ?? []) tagIds.add(await upsertTag(client, t.name, "theme", tagCache));
      for (const t of g.game_modes ?? []) tagIds.add(await upsertTag(client, t.name, "mechanic", tagCache));
      for (const t of g.player_perspectives ?? []) tagIds.add(await upsertTag(client, t.name, "mechanic", tagCache));
      for (const tagId of tagIds) {
        await client.query(`INSERT INTO game_tags (game_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [gameId, tagId]);
      }

      const { steamAppId, epicSlug } = storeIds(g);
      if (steamAppId) {
        await client.query(
          `INSERT INTO store_listings (game_id, store_id, store_app_id, store_url, steam_app_link)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [gameId, steamStore, steamAppId, `https://store.steampowered.com/app/${steamAppId}/`, `steam://store/${steamAppId}`]);
      }
      if (epicSlug) {
        await client.query(
          `INSERT INTO store_listings (game_id, store_id, store_app_id, store_url)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [gameId, epicStore, epicSlug, `https://store.epicgames.com/p/${epicSlug}`]);
      }
      n++;
    }
  });
  console.log(`  saved ${n} games`);
}

/** Maps our listings to IsThereAnyDeal game ids in bulk (one request per 200 store ids). */
async function linkItad() {
  const key = process.env.ITAD_API_KEY!;
  const rows = await q<{ game_id: string; code: string; store_app_id: string }>(
    `SELECT sl.game_id, s.code, sl.store_app_id FROM store_listings sl
     JOIN stores s ON s.id = sl.store_id JOIN games g ON g.id = sl.game_id
     WHERE g.itad_id IS NULL ORDER BY s.code DESC`); // steam first
  const found = new Map<string, string>(); // game_id -> itad id
  for (const [code, shopId, prefix] of [["steam", 61, "app/"], ["epic", 16, ""]] as const) {
    const todo = rows.filter((r) => r.code === code && !found.has(r.game_id));
    for (let i = 0; i < todo.length; i += 200) {
      const chunk = todo.slice(i, i + 200);
      const r = await fetch(`https://api.isthereanydeal.com/lookup/id/shop/${shopId}/v1?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map((c) => prefix + c.store_app_id)),
      });
      if (!r.ok) throw new Error(`ITAD lookup ${r.status}`);
      const map: Record<string, string | null> = await r.json();
      for (const c of chunk) {
        const id = map[prefix + c.store_app_id];
        if (id) found.set(c.game_id, id);
      }
    }
  }
  // Two IGDB entries can map to the same ITAD game (editions); keep the more popular one.
  let linked = 0;
  for (const [gameId, itadId] of found) {
    const res = await q(
      `UPDATE games SET itad_id = $2 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM games WHERE itad_id = $2) RETURNING id`,
      [gameId, itadId]);
    linked += res.length;
  }
  console.log(`  ITAD linked ${linked} of ${new Set(rows.map((r) => r.game_id)).size} unlinked games`);
}

async function main() {
  console.log("Fetching from IGDB...");
  const released = await fetchReleased();
  const upcoming = await fetchUpcoming();
  const seen = new Set<number>();
  const all: { g: IgdbGame; status: string; popularity: number }[] = [];
  // Rank-based popularity in 0..1000 within each group.
  released.forEach((g, i) => {
    if (seen.has(g.id)) return;
    seen.add(g.id);
    const status = g.game_status === STATUS_EARLY_ACCESS ? "early_access" : "released";
    all.push({ g, status, popularity: 1000 * (1 - i / released.length) });
  });
  upcoming.forEach((g, i) => {
    if (seen.has(g.id)) return;
    seen.add(g.id);
    all.push({ g, status: "upcoming", popularity: 1000 * (1 - i / upcoming.length) });
  });
  console.log("Fetching playtimes...");
  const playtimes = await fetchPlaytimes(all.map((a) => a.g.id));
  console.log(`  playtimes for ${playtimes.size} games`);
  console.log("Saving...");
  await save(all, playtimes);
  console.log("Linking IsThereAnyDeal ids...");
  await linkItad();
  const [stats] = await q(`SELECT
      (SELECT count(*) FROM games) games,
      (SELECT count(*) FROM games WHERE release_status='upcoming') upcoming,
      (SELECT count(*) FROM games WHERE itad_id IS NOT NULL) with_itad,
      (SELECT count(*) FROM store_listings WHERE store_id=1) steam,
      (SELECT count(*) FROM store_listings WHERE store_id=2) epic,
      (SELECT count(*) FROM tags) tags`);
  console.log(stats);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
