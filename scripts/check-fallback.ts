// Offline checks for the keyword fallback parser (no API calls). Exit code 1 on any failure.
import { parseFallback, sameConstraints } from "../lib/search/fallbackParser";
import { EMPTY_FILTERS, guardInventedLimits, type Filters } from "../lib/search/filters";

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

// LLM said max_price_cents = 0: kept only when the message says free, or an earlier turn already did.
const free = { ...EMPTY_FILTERS, max_price_cents: 0 };
const budgetCases: [string, Filters | null, number | undefined][] = [
  ["short roguelike I can finish in a weekend", null, undefined],
  ["something for my free time", null, undefined],
  ["free horror games", null, 0],
  ["any good f2p shooters?", null, 0],
  ["make it co-op", free, 0],
  ["something shorter", { ...EMPTY_FILTERS, max_price_cents: 2000 }, 2000],
];
for (const [msg, prev, want] of budgetCases) {
  const got = guardInventedLimits(free, msg, prev, EMPTY_FILTERS).max_price_cents;
  if (got !== want) fail++;
  console.log(`${got === want ? "ok  " : "FAIL"} free guard: ${msg}${got === want ? "" : `  -> ${got} (want ${want})`}`);
}

// LLM said max_playtime_hrs = 12: kept only when the message talks about length.
const short = { ...EMPTY_FILTERS, max_playtime_hrs: 12 };
const lengthCases: [string, Filters | null, number | undefined][] = [
  ["roguelike", null, undefined],
  ["co-op horror", null, undefined],
  ["short roguelike I can finish in a weekend", null, 12],
  ["something under 10 hours", null, 12],
  ["a quick game for tonight", null, 12],
  ["make it co-op", short, 12],
];
for (const [msg, prev, want] of lengthCases) {
  const got = guardInventedLimits(short, msg, prev, EMPTY_FILTERS).max_playtime_hrs;
  if (got !== want) fail++;
  console.log(`${got === want ? "ok  " : "FAIL"} length guard: ${msg}${got === want ? "" : `  -> ${got} (want ${want})`}`);
}
{
  // LLM left playtime out although the keyword rules found "short".
  const msg = "short roguelike";
  const got = guardInventedLimits(EMPTY_FILTERS, msg, null, parseFallback(msg, "IN")).max_playtime_hrs;
  if (got !== 12) fail++;
  console.log(`${got === 12 ? "ok  " : "FAIL"} length guard fills in: ${msg}${got === 12 ? "" : `  -> ${got} (want 12)`}`);
}

// Similar-query cache: reuse only when both wordings carry the same constraints.
const similarCases: [string, string, boolean][] = [
  ["short roguelike", "roguelike", false],
  ["roguelike under 500 rs", "roguelike", false],
  ["co op horror", "horror", false],
  ["roguelike games", "roguelikes", true],
  ["a cozy farming game", "cozy farming games", true],
];
for (const [a, b, want] of similarCases) {
  const got = sameConstraints(a, b, "IN");
  if (got !== want) fail++;
  console.log(`${got === want ? "ok  " : "FAIL"} same constraints: "${a}" vs "${b}"${got === want ? "" : `  -> ${got} (want ${want})`}`);
}
process.exit(fail ? 1 : 0);
