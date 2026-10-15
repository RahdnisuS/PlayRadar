// Adds Epic listings for catalog games that IGDB only linked to Steam, using IsThereAnyDeal: if ITAD has an
// Epic price for the game, its deal link redirects to the Epic store page, which gives us the slug.
// Re-runnable and additive (never deletes). Then refreshes prices for the new listings in every region.
// Usage: npx tsx scripts/add-epic-listings.ts [--dry]
import "./env";
import { q, closeDb } from "./db";
import { epicSlugFromUrl } from "../lib/igdb/client";
import { refreshPrices } from "../lib/prices/service";
import { REGIONS } from "../lib/regions";

const DRY = process.argv.includes("--dry");
const EPIC_SHOP = 16;

/** Follows itad.link redirects until the Epic store URL appears (the Epic page itself may refuse bots). */
async function resolveEpicSlug(url: string): Promise<string | null> {
  let next = url;
  for (let i = 0; i < 6; i++) {
    const slug = epicSlugFromUrl(next);
    if (slug) return slug;
    const r = await fetch(next, { redirect: "manual", signal: AbortSignal.timeout(10000) }).catch(() => null);
    const loc = r?.headers.get("location");
    if (!loc) return null;
    next = new URL(loc, next).toString();
  }
  return null;
}

async function main() {
  const games = await q<{ id: string; itad_id: string; title: string }>(
    `SELECT g.id, g.itad_id, g.title FROM games g WHERE g.itad_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM store_listings sl JOIN stores s ON s.id = sl.store_id WHERE sl.game_id = g.id AND s.code = 'epic')
     ORDER BY g.popularity DESC`,
  );
  const [{ id: epicStore }] = await q<{ id: number }>(`SELECT id FROM stores WHERE code = 'epic'`);

  const deals = new Map<string, string>(); // itad id -> deal url
  for (let i = 0; i < games.length; i += 200) {
    const r = await fetch(
      `https://api.isthereanydeal.com/games/prices/v3?country=US&shops=${EPIC_SHOP}&deals=false&key=${process.env.ITAD_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(games.slice(i, i + 200).map((g) => g.itad_id)) },
    );
    if (!r.ok) throw new Error(`ITAD prices ${r.status}`);
    for (const e of (await r.json()) as { id: string; deals: { url: string }[] }[]) if (e.deals?.[0]?.url) deals.set(e.id, e.deals[0].url);
  }
  console.log(`${games.length} games have no Epic listing; IsThereAnyDeal sells ${deals.size} of them on Epic.`);

  const added: string[] = [];
  for (const g of games) {
    const url = deals.get(g.itad_id);
    if (!url) continue;
    const slug = await resolveEpicSlug(url);
    if (!slug) {
      console.log(`  ? ${g.title}: could not resolve the Epic link`);
      continue;
    }
    console.log(`  + ${g.title} -> ${slug}`);
    if (DRY) continue;
    const rows = await q(
      `INSERT INTO store_listings (game_id, store_id, store_app_id, store_url) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [g.id, epicStore, slug, `https://store.epicgames.com/p/${slug}`],
    );
    if (rows.length) added.push(g.id);
    else console.log(`    (skipped: slug already belongs to another game)`);
  }

  if (!DRY && added.length) {
    for (const { code } of REGIONS) await refreshPrices(added, code, { backfill: false });
    console.log(`Added ${added.length} Epic listings and priced them in ${REGIONS.length} regions.`);
  } else if (DRY) console.log("Dry run: nothing written.");
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
