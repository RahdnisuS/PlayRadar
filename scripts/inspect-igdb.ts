// Debug helper: print IGDB store ids for games matching a name. Usage: npx tsx scripts/inspect-igdb.ts "Grand Theft Auto V"
import "./env";
import { igdb, SOURCE_STEAM, SOURCE_EPIC } from "../lib/igdb/client";

async function main() {
  const name = process.argv[2];
  const rows = await igdb<{ id: number; name: string; game_type: number; total_rating_count?: number; external_games?: { external_game_source: number; uid: string; url?: string }[] }>(
    "games",
    `fields name, game_type, total_rating_count, external_games.external_game_source, external_games.uid, external_games.url; search "${name.replace(/"/g, "")}"; where platforms = (6); limit 10;`,
  );
  for (const g of rows) {
    const stores = (g.external_games ?? []).filter((e) => [SOURCE_STEAM, SOURCE_EPIC].includes(e.external_game_source));
    console.log(`${g.id} ${g.name} type=${g.game_type} ratings=${g.total_rating_count ?? 0} | ${stores.map((s) => `${s.external_game_source === SOURCE_STEAM ? "steam" : "epic"}:${s.uid}`).join(" ")}`);
  }
}
main();
