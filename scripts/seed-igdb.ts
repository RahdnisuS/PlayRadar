// Seeds ~2,000 games from IGDB: popular released PC games plus the most-wishlisted upcoming ones,
// each sold on Steam and/or Epic. Re-runnable: everything upserts on igdb_id / unique keys.
// Usage: npx tsx scripts/seed-igdb.ts [--released 1700] [--upcoming 300]
import "./env";
import { q, tx, closeDb } from "./db";
import {
  igdb, SOURCE_STEAM, SOURCE_EPIC, GAME_TYPES_BASE, STATUS_EARLY_ACCESS, STATUSES_SKIP,
  POP_STEAM_MOST_WISHLISTED_UPCOMING,
} from "../lib/igdb/client";
import {
  DETAIL_FIELDS, fetchPlaytimes, itadLookup, saveIgdbGame, storeIds,
  type IgdbGame, type Resolved, type TagCache,
} from "../lib/igdb/catalog";
import { itadProvider } from "../lib/prices/itad";

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const RELEASED_TARGET = arg("released", 1700);
const UPCOMING_TARGET = arg("upcoming", 300);

const BASE_WHERE = `platforms = (6) & game_type = (${GAME_TYPES_BASE}) & game_status != (${STATUSES_SKIP})`;
const STORE_WHERE = `external_games.external_game_source = (${SOURCE_STEAM},${SOURCE_EPIC})`;

const hasStore = (g: IgdbGame) => {
  const s = storeIds(g);
  return s.steamAppIds.length > 0 || !!s.epicSlug;
};

async function fetchReleasedSince(since: number, target: number, skip: Set<number>): Promise<IgdbGame[]> {
  const now = Math.floor(Date.now() / 1000);
  const out: IgdbGame[] = [];
  for (let offset = 0; out.length < target && offset < 5000; offset += 500) {
    const page = await igdb<IgdbGame>("games",
      `fields ${DETAIL_FIELDS}; where ${BASE_WHERE} & ${STORE_WHERE} & first_release_date < ${now}` +
      ` & first_release_date >= ${since} & total_rating_count > 0; sort total_rating_count desc; limit 500; offset ${offset};`);
    if (page.length === 0) break;
    for (const g of page) {
      if (hasStore(g) && !skip.has(g.id)) out.push(g);
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
      if (notOut && g.game_status !== 0 && hasStore(g)) out.push(g);
    }
  }
  out.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  console.log(`  upcoming: ${out.length}`);
  return out.slice(0, UPCOMING_TARGET);
}

async function save(
  games: { g: IgdbGame; status: string; popularity: number }[],
  playtimes: Map<number, number>,
  stores: Map<number, Resolved | null>,
) {
  const tagCache: TagCache = new Map();
  const [{ id: steamStore }] = await q(`SELECT id FROM stores WHERE code='steam'`);
  const [{ id: epicStore }] = await q(`SELECT id FROM stores WHERE code='epic'`);
  let n = 0;
  await tx(async (client) => {
    for (const { g, status, popularity } of games) {
      const resolved = stores.get(g.id);
      if (!resolved) continue; // duplicate of a more popular entry, or no usable store listing
      await saveIgdbGame(client, g, {
        status, popularity, playtime: playtimes.get(g.id) ?? null, resolved,
        stores: { steam: steamStore, epic: epicStore }, tagCache,
      });
      n++;
    }
  });
  console.log(`  saved ${n} games`);
}

/**
 * Picks one sellable product per IGDB game and drops duplicates:
 *  - with several Steam apps, prefer the one whose ITAD game currently has a Steam/Epic price (IN or US),
 *    then the newest (highest) appid — this skips delisted originals in favour of re-releases;
 *  - an Epic slug is kept only if it maps to the same ITAD game (or ITAD doesn't know it);
 *  - when two IGDB entries resolve to the same ITAD game, the more popular one wins and the other is skipped.
 * Returns null for skipped duplicates.
 */
async function resolveStores(games: { g: IgdbGame; popularity: number }[]): Promise<Map<number, Resolved | null>> {
  const ids = new Map(games.map(({ g }) => [g.id, storeIds(g)]));
  const steamMap = await itadLookup(61, [...new Set([...ids.values()].flatMap((s) => s.steamAppIds.map((a) => `app/${a}`)))]);
  const epicMap = await itadLookup(16, [...new Set([...ids.values()].flatMap((s) => (s.epicSlug ? [s.epicSlug] : [])))]);

  const candidates = (igdbId: number) => {
    const s = ids.get(igdbId)!;
    const c = new Set<string>();
    for (const a of s.steamAppIds) if (steamMap[`app/${a}`]) c.add(steamMap[`app/${a}`]!);
    if (s.epicSlug && epicMap[s.epicSlug]) c.add(epicMap[s.epicSlug]!);
    return [...c];
  };
  const ambiguous = [...new Set(games.flatMap(({ g }) => (candidates(g.id).length > 1 ? candidates(g.id) : [])))];
  const sellable = new Set<string>();
  for (const country of ["IN", "US"]) {
    for (const quote of await itadProvider.getPrices(ambiguous, country)) sellable.add(quote.providerGameId);
  }
  console.log(`  ${ambiguous.length} candidate products for multi-listing games, ${sellable.size} on sale`);

  const out = new Map<number, Resolved | null>();
  const claimed = new Set<string>();
  for (const { g } of [...games].sort((a, b) => b.popularity - a.popularity)) {
    const s = ids.get(g.id)!;
    const cands = candidates(g.id);
    const appidFor = (itad: string) =>
      s.steamAppIds.filter((a) => steamMap[`app/${a}`] === itad).sort((x, y) => Number(y) - Number(x))[0] ?? null;
    let itadId: string | null = null;
    if (cands.length === 1) itadId = cands[0];
    else if (cands.length > 1) {
      const ranked = [...cands].sort((x, y) =>
        Number(sellable.has(y)) - Number(sellable.has(x)) || Number(appidFor(y) ?? 0) - Number(appidFor(x) ?? 0));
      itadId = ranked[0];
    }
    if (itadId && claimed.has(itadId)) {
      out.set(g.id, null);
      continue;
    }
    if (itadId) claimed.add(itadId);
    const steamAppId = itadId
      ? appidFor(itadId)
      : [...s.steamAppIds].sort((x, y) => Number(y) - Number(x))[0] ?? null;
    const epicSlug = s.epicSlug && (!epicMap[s.epicSlug] || epicMap[s.epicSlug] === itadId) ? s.epicSlug : null;
    out.set(g.id, steamAppId || epicSlug ? { itadId, steamAppId, epicSlug } : null);
  }
  return out;
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
  console.log("Resolving store listings via IsThereAnyDeal...");
  const stores = await resolveStores(all);
  console.log(`  skipped ${[...stores.values()].filter((r) => r === null).length} duplicates / unusable entries`);
  console.log("Saving...");
  await save(all, playtimes, stores);
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
