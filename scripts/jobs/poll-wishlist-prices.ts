// Every 4 hours: refresh prices of wishlisted games in each wishlisting user's region (with history backfill),
// so sales are noticed sooner than the daily catalog refresh. Run scripts/jobs/alerts.ts afterwards.
import "../env";
import { q, closeDb } from "../db";
import { refreshPrices } from "../../lib/prices/service";

async function main() {
  const rows = await q<{ country_code: string; game_ids: string[] }>(
    `SELECT trim(u.country_code) AS country_code, array_agg(DISTINCT w.game_id) AS game_ids
     FROM wishlist_items w JOIN users u ON u.id = w.user_id
     WHERE u.email_verified AND u.email_digest <> 'off'
     GROUP BY u.country_code`,
  );
  for (const { country_code, game_ids } of rows) {
    let changed = 0;
    for (let i = 0; i < game_ids.length; i += 200) {
      changed += (await refreshPrices(game_ids.slice(i, i + 200), country_code)).changed.length;
    }
    console.log(`${country_code}: ${game_ids.length} wishlisted games, ${changed} price changes`);
  }
  if (!rows.length) console.log("no wishlisted games to poll");
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
