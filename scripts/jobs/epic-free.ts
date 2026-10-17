// Epic free games: reads Epic's giveaway feed, adds missing games to the catalog (priced in all regions), records
// current and upcoming giveaways in free_promotions, and queues free_to_claim alerts. scripts/jobs/alerts.ts sends them.
// Usage: npx tsx scripts/jobs/epic-free.ts [--dry]   (--dry: print matches, write nothing)
import "../env";
import { q, closeDb } from "../db";
import { fetchFreeGames } from "../../lib/epic/freeGames";
import { findOrAddFreeGame } from "../../lib/catalog/freeGames";
import { queueFreeGameAlerts } from "../../lib/alerts/queue";
import { refreshPrices } from "../../lib/prices/service";
import { REGIONS } from "../../lib/regions";

const DRY = process.argv.includes("--dry");
const day = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

async function main() {
  const now = new Date();
  const promos = (await fetchFreeGames()).filter((p) => p.endsAt > now);
  console.log(`${promos.length} current or upcoming Epic giveaways`);
  const [{ id: epicStore }] = await q<{ id: number }>(`SELECT id FROM stores WHERE code = 'epic'`);

  const added: string[] = [];
  for (const p of promos) {
    const state = p.startsAt <= now ? "free now" : "upcoming";
    const m = await findOrAddFreeGame(p, { dry: DRY });
    console.log(`  ${p.title} [${state}, ${day(p.startsAt)} → ${day(p.endsAt)} UTC] → game ${m.gameId} (${m.how})`);
    if (DRY) continue;
    if (m.how.startsWith("added")) added.push(m.gameId);
    await q(
      `INSERT INTO free_promotions (game_id, store_id, starts_at, ends_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (game_id, store_id, starts_at) DO UPDATE SET ends_at = EXCLUDED.ends_at`,
      [m.gameId, epicStore, p.startsAt, p.endsAt],
    );
  }

  if (DRY) {
    console.log("Dry run: nothing written.");
  } else {
    if (added.length) {
      for (const { code } of REGIONS) await refreshPrices(added, code, { backfill: false });
      console.log(`Added ${added.length} games to the catalog and priced them in ${REGIONS.length} regions.`);
    }
    console.log(`Queued ${await queueFreeGameAlerts()} free-game alerts.`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
