// Daily: refresh default-region (IN) current prices for the whole catalog so budget filters work.
// No history backfill here (that happens lazily per game). ~10 ITAD calls for 2,000 games.
// --report-unsold lists released games not sold on Steam/Epic in IN or US. They stay in the catalog and show as
// "Price unavailable" (often region locks); duplicates of a sellable edition are removed by scripts/dedupe-editions.ts.
import "../env";
import { q, closeDb } from "../db";
import { refreshPrices } from "../../lib/prices/service";

const COUNTRY = "IN";
const REPORT = process.argv.includes("--report-unsold");

async function main() {
  const ids = (await q<{ id: string }>(`SELECT id FROM games ORDER BY popularity DESC`)).map((r) => r.id);
  let changed = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const res = await refreshPrices(ids.slice(i, i + 200), COUNTRY, { backfill: false });
    changed += res.changed.length;
    console.log(`  ${Math.min(i + 200, ids.length)}/${ids.length} games, ${changed} price changes`);
  }

  if (REPORT) {
    // Released Steam games with no IN price from either source: double-check US (some are region-locked in IN).
    // Epic-only games are never pruned: there is no free fallback source to confirm they are gone.
    const noIn = (await q<{ id: string }>(
      `SELECT g.id FROM games g WHERE g.release_status <> 'upcoming'
       AND EXISTS (SELECT 1 FROM store_listings s JOIN stores st ON st.id = s.store_id WHERE s.game_id = g.id AND st.code = 'steam')
       AND NOT EXISTS (
         SELECT 1 FROM store_listings sl JOIN price_summary ps ON ps.listing_id = sl.id
         WHERE sl.game_id = g.id AND ps.country_code = 'IN')`)).map((r) => r.id);
    for (let i = 0; i < noIn.length; i += 200) await refreshPrices(noIn.slice(i, i + 200), "US", { backfill: false });
    const unsold = await q<{ id: string; title: string; itad_id: string | null }>(
      `SELECT g.id, g.title, g.itad_id FROM games g WHERE g.id = ANY($1::bigint[]) AND NOT EXISTS (
         SELECT 1 FROM store_listings sl JOIN price_summary ps ON ps.listing_id = sl.id WHERE sl.game_id = g.id)
       ORDER BY g.popularity DESC`,
      [noIn],
    );
    console.log(`${unsold.length} released games with no Steam/Epic price in IN or US:`);
    for (const u of unsold) console.log(`  - ${u.title}${u.itad_id ? "" : " (not on IsThereAnyDeal)"}`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
