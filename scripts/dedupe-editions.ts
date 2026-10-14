// Removes unpriced games whose sellable edition is already a separate catalog entry
// (e.g. delisted "Death Stranding" when "Death Stranding: Director's Cut" is in the catalog and priced).
// Unpriced games without such an edition are kept and shown as "Price unavailable".
// Usage: npx tsx scripts/dedupe-editions.ts [--dry]
import "./env";
import { q, closeDb } from "./db";
import { isEditionOf } from "../lib/catalog/editions";

const DRY = process.argv.includes("--dry");

async function main() {
  const unpriced = await q<{ id: string; title: string }>(
    `SELECT g.id, g.title FROM games g WHERE g.release_status <> 'upcoming'
     AND NOT EXISTS (SELECT 1 FROM store_listings sl JOIN price_summary ps ON ps.listing_id = sl.id WHERE sl.game_id = g.id)`,
  );
  const priced = await q<{ title: string }>(
    `SELECT DISTINCT g.title FROM games g JOIN store_listings sl ON sl.game_id = g.id JOIN price_summary ps ON ps.listing_id = sl.id`,
  );
  const dupes = unpriced
    .map((u) => ({ ...u, edition: priced.find((p) => isEditionOf(p.title, u.title))?.title }))
    .filter((u) => u.edition);
  console.log(`${dupes.length} of ${unpriced.length} unpriced games have a sellable edition in the catalog:`);
  for (const d of dupes) console.log(`  - ${d.title}  ->  ${d.edition}`);
  if (!DRY && dupes.length) {
    await q(`DELETE FROM games WHERE id = ANY($1::bigint[])`, [dupes.map((d) => d.id)]);
    console.log(`deleted ${dupes.length}; ${unpriced.length - dupes.length} unpriced games kept`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
