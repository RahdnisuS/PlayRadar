// Offline checks for the keyword fallback parser (no API calls). Exit code 1 on any failure.
import { parseFallback } from "../lib/search/fallbackParser";

type Expect = Partial<Record<"max_price_cents" | "max_playtime_hrs" | "min_playtime_hrs" | "coop" | "single_player", unknown>> & {
  tags?: string[];
  excluded?: string[];
};
const cases: [string, Expect][] = [
  ["fast-paced shooter with friends, nothing over 1500 rupees", { max_price_cents: 150000, coop: true, tags: ["Shooter"] }],
  ["something dark and atmospheric, solo, under 15 hours", { max_playtime_hrs: 15, max_price_cents: undefined, single_player: true }],
  ["cozy co-op under ₹800, nothing scary", { max_price_cents: 80000, coop: true, tags: ["cozy"], excluded: ["Horror"] }],
  ["rpg under $20 with at least 40 hours", { max_price_cents: 2000, min_playtime_hrs: 40, tags: ["Role-playing (RPG)"] }],
  ["free horror games", { max_price_cents: 0, tags: ["Horror"] }],
  ["a short puzzle game", { max_playtime_hrs: 12, tags: ["Puzzle"] }],
  ["no more than 500 rs, strategy", { max_price_cents: 50000, tags: ["Strategy"] }],
  ["top-down soulslike", { tags: ["Soulslike", "Bird view / Isometric", "challenging"] }],
  ["a roguelite deckbuilder", { tags: ["Roguelike", "Deckbuilder"], excluded: [] }],
  ["cozy farming game", { tags: ["cozy", "Farming"] }],
];

let fail = 0;
for (const [msg, want] of cases) {
  const f = parseFallback(msg, "IN");
  const problems: string[] = [];
  for (const k of ["max_price_cents", "max_playtime_hrs", "min_playtime_hrs", "coop", "single_player"] as const) {
    if (k in want && f[k] !== want[k]) problems.push(`${k}=${f[k]} (want ${want[k]})`);
  }
  for (const t of want.tags ?? []) if (!f.tags_any.includes(t)) problems.push(`missing tag ${t}`);
  for (const t of want.excluded ?? []) if (!f.tags_exclude.includes(t)) problems.push(`missing exclusion ${t}`);
  if (problems.length) fail++;
  console.log(`${problems.length ? "FAIL" : "ok  "} ${msg}${problems.length ? "  -> " + problems.join(", ") : ""}`);
}
process.exit(fail ? 1 : 0);
