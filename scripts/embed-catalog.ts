// Offline catalog embeddings with Supabase/gte-small (384-dim), the same model the embed edge function
// uses for queries. Embeds games with no embedding or an outdated embedding_model.
// Usage: npx tsx scripts/embed-catalog.ts [--all]
import "./env";
import { pipeline } from "@huggingface/transformers";
import { q, closeDb } from "./db";

export const EMBEDDING_MODEL = "gte-small";
const BATCH = 32;

// gte-small truncates at 512 tokens; keep the most useful text first.
function docText(g: { title: string; tags: string | null; summary: string | null }) {
  return `${g.title}. ${g.tags ?? ""}. ${g.summary ?? ""}`.slice(0, 1500);
}

async function main() {
  const all = process.argv.includes("--all");
  const games = await q<{ id: string; title: string; tags: string | null; summary: string | null }>(
    `SELECT g.id, g.title, g.summary,
            (SELECT string_agg(t.name, ', ' ORDER BY t.kind, t.name) FROM game_tags gt JOIN tags t ON t.id = gt.tag_id
             WHERE gt.game_id = g.id) AS tags
     FROM games g
     WHERE $1 OR g.embedding IS NULL OR g.embedding_model IS DISTINCT FROM $2
     ORDER BY g.id`,
    [all, EMBEDDING_MODEL],
  );
  console.log(`${games.length} games to embed`);
  const extractor = await pipeline("feature-extraction", "Supabase/gte-small");
  for (let i = 0; i < games.length; i += BATCH) {
    const batch = games.slice(i, i + BATCH);
    const out = await extractor(batch.map(docText), { pooling: "mean", normalize: true });
    const vecs = out.tolist() as number[][];
    for (let j = 0; j < batch.length; j++) {
      await q(`UPDATE games SET embedding = $2::vector, embedding_model = $3 WHERE id = $1`, [
        batch[j].id, `[${vecs[j].join(",")}]`, EMBEDDING_MODEL,
      ]);
    }
    console.log(`  ${Math.min(i + BATCH, games.length)}/${games.length}`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
