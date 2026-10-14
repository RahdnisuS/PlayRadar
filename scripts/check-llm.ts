// Smoke test for the Groq roles: filter extraction (gpt-oss-20b) and explanations (qwen).
import "./env";
import { extractFilters } from "../lib/llm/extractFilters";
import { explainResults } from "../lib/llm/explain";
import { parseFallback } from "../lib/search/fallbackParser";

const vocab = [
  ...["Adventure", "Role-playing (RPG)", "Shooter", "Simulator", "Puzzle", "Indie", "Strategy"].map((name) => ({ name, kind: "genre" })),
  ...["Horror", "Fantasy", "Science fiction", "Comedy", "Open world", "Survival"].map((name) => ({ name, kind: "theme" })),
  ...["cozy", "relaxing", "dark", "atmospheric", "funny", "story-rich"].map((name) => ({ name, kind: "mood" })),
  ...["Single player", "Co-operative", "Multiplayer", "First person"].map((name) => ({ name, kind: "mechanic" })),
];

async function main() {
  const msg = "cozy co-op farming game for me and my girlfriend, under 800 rupees, nothing scary";
  let t = Date.now();
  console.log("LLM filters:", JSON.stringify(await extractFilters(msg, null, "IN", vocab)), `${Date.now() - t}ms`);
  console.log("Fallback  :", JSON.stringify(parseFallback(msg, "IN")));
  t = Date.now();
  console.log("Reasons:", await explainResults(msg, [
    { id: "1", title: "Stardew Valley", tags: ["Simulator", "Indie", "cozy", "relaxing", "Co-operative"], summary: "Inherit your grandfather's old farm plot.", coop: true, hours: 53 },
  ]), `${Date.now() - t}ms`);
}
main().catch((e) => { console.error(e); process.exit(1); });
