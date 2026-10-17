// Offline checks for the Epic giveaway feed parser and the free-game email wording (no DB, no API calls).
// Exit code 1 on any failure.
import { epicPageSlug, parseFreeGames, type FeedElement } from "../lib/epic/freeGames";
import { renderEmail, type EmailItem } from "../lib/alerts/email";

let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
};

const offer = (start: string, end: string, pct: number) => ({ startDate: start, endDate: end, discountSetting: { discountPercentage: pct } });
const el = (p: Partial<FeedElement>): FeedElement => ({
  id: "abc",
  namespace: "ns",
  title: "Some Game",
  offerType: "BASE_GAME",
  catalogNs: { mappings: [{ pageSlug: "some-game-1a2b3c", pageType: "productHome" }] },
  keyImages: [{ type: "Thumbnail", url: "thumb.png" }, { type: "OfferImageTall", url: "tall.png" }],
  promotions: { promotionalOffers: [{ promotionalOffers: [offer("2026-10-15T15:00:00.000Z", "2026-10-22T15:00:00.000Z", 0)] }] },
  ...p,
});

// Slugs
check("slug from productHome mapping", epicPageSlug(el({})) === "some-game-1a2b3c");
check("slug from legacy productSlug", epicPageSlug(el({ catalogNs: { mappings: [] }, productSlug: "hades/home" })) === "hades");
check("hex urlSlug is not a page", epicPageSlug(el({ catalogNs: { mappings: null }, urlSlug: "ff70f2b02fd842f8961f7729af25cda9" })) === null);
check("readable urlSlug is used", epicPageSlug(el({ catalogNs: { mappings: null }, urlSlug: "luftrausers" })) === "luftrausers");

// Which offers count as giveaways
const free = parseFreeGames([el({})]);
check("current 100%-off offer is a giveaway", free.length === 1 && free[0].slug === "some-game-1a2b3c", free);
check("tall cover preferred", free[0]?.coverUrl === "tall.png", free[0]?.coverUrl);
check("ordinary sale is not", parseFreeGames([el({ promotions: { promotionalOffers: [{ promotionalOffers: [offer("2026-10-15T15:00:00Z", "2026-10-22T15:00:00Z", 40)] }] } })]).length === 0);
check(
  "upcoming giveaway is kept",
  parseFreeGames([el({ promotions: { promotionalOffers: [], upcomingPromotionalOffers: [{ promotionalOffers: [offer("2026-10-22T15:00:00Z", "2026-10-29T15:00:00Z", 0)] }] } })]).length === 1,
);
check("add-on is skipped", parseFreeGames([el({ offerType: "ADD_ON" })]).length === 0);
check("mystery placeholder is skipped", parseFreeGames([el({ title: "Mystery Game 3" })]).length === 0);
check("no promotions", parseFreeGames([el({ promotions: null })]).length === 0);
check("bundle counts", parseFreeGames([el({ offerType: "BUNDLE" })]).length === 1);

// Email wording
const item = (p: Partial<EmailItem>): EmailItem => ({
  title: "Bad Cheese",
  coverUrl: null,
  kinds: ["free_to_claim"],
  releaseStatus: "released",
  storeName: "Epic Games Store",
  storeUrl: "https://store.epicgames.com/p/bad-cheese-4256d9",
  priceCents: 0,
  regularCents: 46900,
  currency: "INR",
  saleEndsAt: new Date("2026-10-22T15:00:00Z"),
  targetCents: null,
  targetCurrency: null,
  ...p,
});
const ctx = { siteUrl: "https://x", unsubscribeUrl: "https://x/u", country: "IN", digest: "instant" as const };
const one = renderEmail([item({})], ctx);
check("single subject", one.subject === "Bad Cheese is free to keep on Epic until 22 Oct (usually ₹469)", one.subject);
check("claim button", one.html.includes("Claim on Epic Games Store"));
check("no -100% badge", !one.html.includes("-100%"));
check("footer explains free alerts", one.text.includes("tell you when Epic gives a game away") && !one.text.includes("wishlisted"));
const two = renderEmail([item({}), item({ title: "Agent A", regularCents: null, currency: null })], { ...ctx, digest: "weekly" });
check("multi-free subject", two.subject === "Free on Epic: Bad Cheese, Agent A", two.subject);
check("no price known still says Free", two.text.includes("Agent A is free to keep on Epic until 22 Oct\n"), two.text);
const mixed = renderEmail(
  [item({}), item({ title: "Hades", kinds: ["sale"], priceCents: 55000, regularCents: 110000, storeName: "Steam", saleEndsAt: null })],
  ctx,
);
check("mixed footer gives both reasons", mixed.text.includes("wishlisted these games") && mixed.text.includes("Epic gives a game away"));

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
