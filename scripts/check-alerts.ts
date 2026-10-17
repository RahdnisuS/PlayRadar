// Offline checks for the wishlist alert rules (no DB, no API calls). Exit code 1 on any failure.
import { dueAlerts, stillValid, type ListingState, type Snap, type WishlistRule } from "../lib/alerts/rules";

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n));
let id = 0;
const snap = (d: number, price: number, regular = 1000, currency = "INR"): Snap => ({
  id: String(++id),
  at: day(d),
  currency,
  priceCents: price,
  regularCents: regular,
});

const w = (p: Partial<WishlistRule> = {}): WishlistRule => ({
  addedAt: day(5),
  targetCents: null,
  targetCurrency: null,
  alertOnAnySale: true,
  alertOnAllTimeLow: true,
  ...p,
});
const l = (snaps: Snap[], lowestCents: number | null = 500, historyReady = true): ListingState => ({ snaps, lowestCents, historyReady });

type Case = [string, WishlistRule, ListingState, string[]];
const cases: Case[] = [
  ["full price: nothing", w(), l([snap(1, 1000), snap(6, 1000)]), []],
  ["sale started after adding", w(), l([snap(1, 1000), snap(6, 700)]), ["sale"]],
  ["sale already running when added", w(), l([snap(1, 1000), snap(3, 700)]), []],
  ["sale deepened after adding, same run", w(), l([snap(3, 700), snap(6, 600)]), []],
  ["sale ended", w(), l([snap(6, 700), snap(8, 1000)]), []],
  ["second sale after a full-price gap", w(), l([snap(3, 700), snap(4, 1000), snap(7, 800)]), ["sale"]],
  ["sale alerts off", w({ alertOnAnySale: false, alertOnAllTimeLow: false }), l([snap(1, 1000), snap(6, 700)]), []],
  ["new sale at all-time low", w(), l([snap(1, 1000), snap(6, 500)]), ["sale", "all_time_low"]],
  ["below old low", w(), l([snap(1, 1000), snap(6, 400)], 400), ["sale", "all_time_low"]],
  ["sale deepened into ATL after adding", w(), l([snap(3, 700), snap(7, 500)]), ["all_time_low"]],
  ["ATL without history: no ATL alert", w(), l([snap(1, 1000), snap(6, 500)], 500, false), ["sale"]],
  ["target hit by a sale", w({ targetCents: 700, targetCurrency: "INR" }), l([snap(1, 1000), snap(6, 650)]), ["sale", "target_hit"]],
  ["target in other currency ignored", w({ targetCents: 700, targetCurrency: "USD" }), l([snap(1, 1000), snap(6, 650)]), ["sale"]],
  ["already below target when added", w({ targetCents: 1200, targetCurrency: "INR", alertOnAnySale: false }), l([snap(1, 1000)]), []],
  ["base price cut below target", w({ targetCents: 900, targetCurrency: "INR" }), l([snap(1, 1000, 1000), snap(6, 850, 850)]), ["target_hit"]],
  ["no snapshots", w(), l([]), []],
];

let fail = 0;
for (const [name, rule, listing, want] of cases) {
  const got = dueAlerts(rule, listing).map((h) => h.type).sort();
  const ok = JSON.stringify(got) === JSON.stringify([...want].sort());
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: [${got.join(", ")}]${ok ? "" : ` (want [${want.join(", ")}])`}`);
}

const validity: [string, boolean, boolean][] = [
  ["sale still on", stillValid("sale", snap(9, 700), w(), 500), true],
  ["sale over", stillValid("sale", snap(9, 1000), w(), 500), false],
  ["ATL lost", stillValid("all_time_low", snap(9, 600), w(), 500), false],
  ["target still met", stillValid("target_hit", snap(9, 650), w({ targetCents: 700, targetCurrency: "INR" }), 500), true],
  ["target removed", stillValid("target_hit", snap(9, 650), w(), 500), false],
  ["released always", stillValid("released", null, w(), null), true],
];
for (const [name, got, want] of validity) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} send-time: ${name}`);
}
process.exit(fail ? 1 : 0);
