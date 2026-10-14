// Daily: refresh default-region (IN) current prices for the whole catalog so budget filters work.
// No history backfill here (that happens lazily per game). ~10 ITAD calls for 2,000 games.
// --prune deletes released games that aren't sold on Steam or Epic in IN or US (seed-time cleanup only).
import "../env";
import { q, closeDb } from "../db";
import { refreshPrices } from "../../lib/prices/service";

const COUNTRY = "IN";

async function main() {
  const ids = (await q<{ id: string }>(`SELECT id FROM games WHERE itad_id IS NOT NULL ORDER BY popularity DESC`)).map((r) => r.id);
  let changed = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const res = await refreshPrices(ids.slice(i, i + 200), COUNTRY, { backfill: false });
    changed += res.changed.length;
    console.log(`  ${Math.min(i + 200, ids.length)}/${ids.length} games, ${changed} price changes`);
  }

  if (process.argv.includes("--prune")) {
    // Released games with no IN price: double-check US before deleting (some games are region-locked in IN).
    const unsold = (await q<{ id: string }>(
      `SELECT g.id FROM games g WHERE g.release_status <> 'upcoming' AND NOT EXISTS (
         SELECT 1 FROM store_listings sl JOIN price_summary ps ON ps.listing_id = sl.id
         WHERE sl.game_id = g.id AND ps.country_code = 'IN')`)).map((r) => r.id);
    for (let i = 0; i < unsold.length; i += 200) await refreshPrices(unsold.slice(i, i + 200), "US", { backfill: false });
    const deleted = await q<{ title: string }>(
      `DELETE FROM games g WHERE g.id = ANY($1::bigint[]) AND NOT EXISTS (
         SELECT 1 FROM store_listings sl JOIN price_summary ps ON ps.listing_id = sl.id WHERE sl.game_id = g.id)
       RETURNING title`, [unsold]);
    console.log(`pruned ${deleted.length} unsold games: ${deleted.slice(0, 15).map((d) => d.title).join("; ")}${deleted.length > 15 ? "..." : ""}`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
