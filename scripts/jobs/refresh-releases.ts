// Daily: re-checks IGDB for games still marked upcoming or early access, so release dates and statuses stay current
// (wishlist "released" alerts depend on them). Same status rules as seed-igdb.ts.
// Usage: npx tsx scripts/jobs/refresh-releases.ts [--dry]
import "../env";
import { q, closeDb } from "../db";
import { igdb, STATUS_EARLY_ACCESS, STATUSES_SKIP } from "../../lib/igdb/client";
import { earlyAccessDate } from "../../lib/igdb/enrich";

const DRY = process.argv.includes("--dry");

type Row = {
  id: number;
  first_release_date?: number;
  game_status?: number;
  release_dates?: { date?: number; platform?: number; status?: { name?: string } }[];
};
type Game = { id: string; igdb_id: string; title: string; release_status: string; release_date: string | null; early_access_date: string | null };

const isoDate = (unix?: number) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null);
const PC = 6;
const FULL_RELEASE_GAP = 60 * 86400; // same rule as earlyAccessDate(): a release date this long after EA is the 1.0

/**
 * IGDB sets game_status "early access" for games that only plan an early-access launch, so early access needs a
 * date in the past. A game whose release date is well after its early-access start has had its full release.
 */
function releaseStatus(r: Row): "released" | "early_access" | "upcoming" {
  const now = Date.now() / 1000;
  const past = !!r.first_release_date && r.first_release_date <= now;
  const eaStart = (r.release_dates ?? [])
    .filter((d) => d.platform === PC && d.date && d.date <= now && /early access/i.test(d.status?.name ?? ""))
    .map((d) => d.date!)
    .sort((a, b) => a - b)[0];
  const fullAfterEa = past && !!eaStart && r.first_release_date! - eaStart >= FULL_RELEASE_GAP;
  if (past && (r.game_status !== STATUS_EARLY_ACCESS || fullAfterEa)) return "released";
  if (eaStart || (past && r.game_status === STATUS_EARLY_ACCESS)) return "early_access";
  return "upcoming";
}

async function main() {
  const games = await q<Game>(
    `SELECT id, igdb_id, title, release_status, release_date::text, early_access_date::text FROM games
     WHERE igdb_id IS NOT NULL AND release_status IN ('upcoming', 'early_access')`,
  );
  const byIgdb = new Map(games.map((g) => [Number(g.igdb_id), g]));
  let changed = 0;
  for (let i = 0; i < games.length; i += 500) {
    const ids = games.slice(i, i + 500).map((g) => g.igdb_id);
    const rows = await igdb<Row>(
      "games",
      `fields first_release_date,game_status,release_dates.date,release_dates.platform,release_dates.status.name; where id = (${ids}); limit 500;`,
    );
    for (const r of rows) {
      const g = byIgdb.get(r.id)!;
      if (r.game_status != null && STATUSES_SKIP.includes(r.game_status)) continue; // cancelled etc.: leave as is
      const status = releaseStatus(r);
      const date = isoDate(r.first_release_date);
      const ea = earlyAccessDate(r.release_dates, r.first_release_date) ?? g.early_access_date;
      if (status === g.release_status && date === g.release_date && ea === g.early_access_date) continue;
      changed++;
      console.log(`  ${g.title}: ${g.release_status} ${g.release_date ?? "?"} -> ${status} ${date ?? "?"}${ea ? ` (early access ${ea})` : ""}`);
      if (!DRY) {
        await q(`UPDATE games SET release_status = $2, release_date = $3, early_access_date = $4, updated_at = now() WHERE id = $1`, [
          g.id,
          status,
          date,
          ea,
        ]);
      }
    }
  }
  console.log(`${DRY ? "[dry] " : ""}${games.length} upcoming/early-access games checked, ${changed} changed`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
