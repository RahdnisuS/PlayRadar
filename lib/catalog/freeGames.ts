// Finds the catalog game for an Epic giveaway, adding it when it's missing (user decision, 2026-10-17: giveaways are
// usually smaller games outside the seeded catalog). Matching, in order: our Epic listing slug, the IGDB entry
// (by Epic offer id / store URL, then exact title), its Steam app or IsThereAnyDeal id already in our catalog.
// Unknown to IGDB: a basic row from Epic's own data (no tags; prices come from IsThereAnyDeal if it knows the game).
import { q, tx } from "../db";
import { igdb, GAME_TYPES_BASE, epicSlugFromUrl, SOURCE_EPIC } from "../igdb/client";
import { DETAIL_FIELDS, fetchPlaytimes, itadLookup, releaseStatus, saveIgdbGame, storeIds, type IgdbGame } from "../igdb/catalog";
import type { FreeGame } from "../epic/freeGames";

export type CatalogMatch = { gameId: string; how: "epic listing" | "existing game" | "added from IGDB" | "added from Epic" };

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
const quote = (s: string) => `"${s.replace(/["\\]/g, "")}"`;

async function findIgdbGame(f: FreeGame): Promise<IgdbGame | null> {
  const ext = await igdb<{ game?: number; uid: string; url?: string }>(
    "external_games",
    `fields game, uid, url; where external_game_source = ${SOURCE_EPIC} & (uid = ${quote(f.offerId)} | url ~ *${quote(`/p/${f.slug}`)}*); limit 20;`,
  );
  const hit = ext.find((e) => e.game && (e.uid === f.offerId || epicSlugFromUrl(e.url) === f.slug));
  if (hit) {
    const [g] = await igdb<IgdbGame>("games", `fields ${DETAIL_FIELDS}; where id = ${hit.game};`);
    if (g) return g;
  }
  const found = await igdb<IgdbGame>(
    "games",
    `fields ${DETAIL_FIELDS}; search ${quote(f.title)}; where platforms = (6) & game_type = (${GAME_TYPES_BASE}); limit 10;`,
  );
  return found.filter((g) => norm(g.name) === norm(f.title)).sort((a, b) => (b.total_rating_count ?? 0) - (a.total_rating_count ?? 0))[0] ?? null;
}

async function storeIdsFor(): Promise<{ steam: number; epic: number }> {
  const rows = await q<{ id: number; code: string }>(`SELECT id, code FROM stores`);
  return { steam: rows.find((r) => r.code === "steam")!.id, epic: rows.find((r) => r.code === "epic")!.id };
}

async function addEpicListing(gameId: string, slug: string, epicStore: number) {
  await q(
    `INSERT INTO store_listings (game_id, store_id, store_app_id, store_url) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [gameId, epicStore, slug, `https://store.epicgames.com/p/${slug}`],
  );
}

export async function findOrAddFreeGame(f: FreeGame, opts: { dry?: boolean } = {}): Promise<CatalogMatch> {
  const stores = await storeIdsFor();
  const [listed] = await q<{ game_id: string }>(
    `SELECT game_id FROM store_listings WHERE store_id = $1 AND store_app_id = $2`,
    [stores.epic, f.slug],
  );
  if (listed) return { gameId: String(listed.game_id), how: "epic listing" };

  const g = await findIgdbGame(f);
  const steamAppIds = g ? storeIds(g).steamAppIds : [];
  const epicMap = await itadLookup(16, [f.slug]);
  const steamMap = steamAppIds.length ? await itadLookup(61, steamAppIds.map((a) => `app/${a}`)) : {};
  const itadId = epicMap[f.slug] ?? steamAppIds.map((a) => steamMap[`app/${a}`]).find(Boolean) ?? null;

  const [existing] = await q<{ id: string }>(
    `SELECT g.id FROM games g
     WHERE ($1::bigint IS NOT NULL AND g.igdb_id = $1) OR ($2::text IS NOT NULL AND g.itad_id = $2)
        OR EXISTS (SELECT 1 FROM store_listings sl WHERE sl.game_id = g.id AND sl.store_id = $3 AND sl.store_app_id = ANY($4::text[]))
     ORDER BY g.popularity DESC LIMIT 1`,
    [g?.id ?? null, itadId, stores.steam, steamAppIds],
  );
  if (existing) {
    // In the catalog, but without this Epic listing (IGDB often misses Epic pages).
    if (!opts.dry) await addEpicListing(String(existing.id), f.slug, stores.epic);
    return { gameId: String(existing.id), how: "existing game" };
  }
  if (opts.dry) return { gameId: "(new)", how: g ? "added from IGDB" : "added from Epic" };

  if (g) {
    // Prefer the Steam app that is the same IsThereAnyDeal product, then the newest appid.
    const steamAppId =
      steamAppIds.filter((a) => !itadId || !steamMap[`app/${a}`] || steamMap[`app/${a}`] === itadId).sort((x, y) => Number(y) - Number(x))[0] ?? null;
    const playtimes = await fetchPlaytimes([g.id]);
    const gameId = await tx((client) =>
      saveIgdbGame(client, g, {
        status: releaseStatus(g),
        popularity: 0, // outside the seeded popularity ranking
        playtime: playtimes.get(g.id) ?? null,
        resolved: { itadId, steamAppId, epicSlug: f.slug },
        stores,
        tagCache: new Map(),
      }),
    );
    // The IGDB entry may carry a different Epic slug; make sure the giveaway's page is the one we list.
    await addEpicListing(gameId, f.slug, stores.epic);
    return { gameId, how: "added from IGDB" };
  }

  const [row] = await q<{ id: string }>(
    `INSERT INTO games (slug, title, summary, release_status, cover_url, publisher, popularity, external_ids, itad_id)
     VALUES ($1, $2, $3, 'released', $4, $5, 0, $6, $7)
     ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, updated_at = now()
     RETURNING id`,
    [
      `epic-${f.slug}`, f.title, f.description, f.coverUrl, f.seller,
      JSON.stringify({ epic_offer_id: f.offerId, epic_namespace: f.namespace }), itadId,
    ],
  );
  await addEpicListing(String(row.id), f.slug, stores.epic);
  return { gameId: String(row.id), how: "added from Epic" };
}
