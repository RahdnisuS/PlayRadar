// Offline checks for the wait-or-buy hint (no API calls). Exit code 1 on any failure.
import { waitOrBuy, type HintInput } from "../lib/prices/hint";

const base: HintInput = {
  currency: "INR",
  priceCents: 99900,
  regularCents: 99900,
  allTimeLowCents: 39900,
  low12mCents: 49900,
  saleCount12m: 3,
  historyMonths: 12,
};

const cases: [string, Partial<HintInput>, string | null][] = [
  ["full price, frequent sales", {}, "wait"],
  ["full price, one sale", { saleCount12m: 1 }, "wait"],
  ["full price, never discounted", { saleCount12m: 0, low12mCents: 99900 }, "buy"],
  ["on sale at all-time low", { priceCents: 39900 }, "buy"],
  ["on sale below old ATL", { priceCents: 29900 }, "buy"],
  ["on sale at 12-month low", { priceCents: 49900 }, "buy"],
  ["on sale but past year went lower", { priceCents: 69900 }, "either"],
  ["short history", { historyMonths: 2 }, "tracking"],
  ["free to play", { priceCents: 0, regularCents: 0 }, null],
  ["no ATL known, on sale", { priceCents: 49900, allTimeLowCents: null }, "buy"],
];

let fail = 0;
for (const [name, patch, want] of cases) {
  const got = waitOrBuy({ ...base, ...patch });
  const ok = (got?.verdict ?? null) === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got ? `${got.verdict} - ${got.text}` : "no hint"}${ok ? "" : ` (want ${want})`}`);
}
process.exit(fail ? 1 : 0);
