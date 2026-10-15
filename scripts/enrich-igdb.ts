// Adds IGDB-derived extras to existing catalog games (seed-igdb.ts does the same for new games):
// sub-genre/mood/perspective tags from curated IGDB keywords, the keyword list itself (external_ids.igdb_keywords,
// used by mood-tags.ts) and games.early_access_date. Additive and re-runnable.
// Usage: npx tsx scripts/enrich-igdb.ts [--dry]
import "./env";
import { q, closeDb } from "./db";
import { igdb } from "../lib/igdb/client";
import { earlyAccessDate, ENRICH_FIELDS, tagsFromKeywords, usefulKeywords } from "../lib/igdb/enrich";

const DRY = process.argv.includes("--dry");

type Row = {
  id: number;
  first_release_date?: number;
  keywords?: { name: string }[];
  release_dates?: { date?: number; platform?: number; status?: { name?: string } }[];
};

async function main() {
  const games = await q<{ id: string; igdb_id: string; title: string }>(`SELECT id, igdb_id, title FROM games WHERE igdb_id IS NOT NULL`);
  const byIgdb = new Map(games.map((g) => [Number(g.igdb_id), g]));
  const tagIds = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  let eaCount = 0;

  for (let i = 0; i < games.length; i += 500) {
    const ids = games.slice(i, i + 500).map((g) => g.igdb_id).join(",");
    const rows = await igdb<Row>("games", `fields first_release_date,${ENRICH_FIELDS.join(",")}; where id = (${ids}); limit 500;`);
    for (const r of rows) {
      const g = byIgdb.get(r.id);
      if (!g) continue;
      const keywords = (r.keywords ?? []).map((k) => k.name);
      const tags = tagsFromKeywords(keywords);
      const ea = earlyAccessDate(r.release_dates, r.first_release_date);
      for (const t of tags) tagCounts.set(t.name, (tagCounts.get(t.name) ?? 0) + 1);
      if (ea) eaCount++;
      if (DRY) {
        if (ea) console.log(`  ${g.title}: early access ${ea}`);
        continue;
      }
      await q(
        `UPDATE games SET early_access_date = $2, external_ids = external_ids || jsonb_build_object('igdb_keywords', $3::jsonb)
         WHERE id = $1`,
        [g.id, ea, JSON.stringify(usefulKeywords(keywords, 20))],
      );
      for (const t of tags) {
        let tagId = tagIds.get(t.name);
        if (!tagId) {
          const [row] = await q<{ id: number }>(
            `INSERT INTO tags (name, kind) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [t.name, t.kind],
          );
          tagIds.set(t.name, (tagId = row.id));
        }
        await q(`INSERT INTO game_tags (game_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [g.id, tagId]);
      }
    }
    console.log(`  ${Math.min(i + 500, games.length)}/${games.length} games`);
  }
  console.log(`Early-access dates: ${eaCount}`);
  console.log("Tags from keywords:", [...tagCounts].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(", "));
  if (DRY) console.log("Dry run: nothing written.");
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
