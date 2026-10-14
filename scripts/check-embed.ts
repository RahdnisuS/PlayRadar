// Verifies the edge function (query side) and local transformers.js (catalog side) produce the same vectors.
import "./env";
import { pipeline } from "@huggingface/transformers";

const text = "cozy co-op farming game with relaxing vibes";

async function main() {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/embed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.EMBED_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: text }),
  });
  if (!r.ok) throw new Error(`edge function ${r.status}: ${await r.text()}`);
  const remote: number[] = (await r.json()).embedding;

  const extractor = await pipeline("feature-extraction", "Supabase/gte-small");
  const local = Array.from((await extractor(text, { pooling: "mean", normalize: true })).data as Float32Array);

  const dot = remote.reduce((s, v, i) => s + v * local[i], 0);
  console.log(`dims remote=${remote.length} local=${local.length} cosine=${dot.toFixed(5)}`);
}
main();
