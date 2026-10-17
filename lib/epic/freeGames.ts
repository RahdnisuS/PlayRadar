// Epic's public "free games" feed (the one the store's Free Games section uses; no key). A giveaway is a promotional
// offer whose discountPercentage is 0 (Epic stores the price multiplier, so 0 means 100% off). The feed also lists
// ordinary sales and add-ons; parseFreeGames keeps only full games that are, or will be, free to keep.
const FEED = "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions";

type Offer = { startDate: string; endDate: string; discountSetting?: { discountPercentage?: number } };
type Mapping = { pageSlug?: string; pageType?: string };
export type FeedElement = {
  id: string;
  namespace: string;
  title: string;
  description?: string;
  offerType?: string;
  productSlug?: string | null;
  urlSlug?: string | null;
  seller?: { name?: string };
  keyImages?: { type: string; url: string }[];
  catalogNs?: { mappings?: Mapping[] | null };
  offerMappings?: Mapping[] | null;
  promotions?: {
    promotionalOffers?: { promotionalOffers: Offer[] }[];
    upcomingPromotionalOffers?: { promotionalOffers: Offer[] }[];
  } | null;
};

export type FreeGame = {
  offerId: string;
  namespace: string;
  title: string;
  slug: string; // store.epicgames.com/p/<slug>
  description: string | null;
  seller: string | null;
  coverUrl: string | null;
  startsAt: Date;
  endsAt: Date;
};

const GAME_OFFER_TYPES = new Set(["BASE_GAME", "BUNDLE", "EDITION"]);

/** The store page slug: the product home mapping, else the legacy productSlug, else a readable urlSlug. */
export function epicPageSlug(e: FeedElement): string | null {
  const home = [...(e.catalogNs?.mappings ?? []), ...(e.offerMappings ?? [])].find((m) => m.pageType === "productHome" && m.pageSlug);
  if (home?.pageSlug) return home.pageSlug;
  const legacy = e.productSlug?.replace(/\/home$/, "");
  if (legacy) return legacy;
  // urlSlug is sometimes a bare 32-hex offer id, which is not a page.
  return e.urlSlug && !/^[0-9a-f]{32}$/.test(e.urlSlug) ? e.urlSlug : null;
}

/** Current and upcoming giveaways of full games. Mystery placeholders (no real title or page) are skipped. */
export function parseFreeGames(elements: FeedElement[]): FreeGame[] {
  const out: FreeGame[] = [];
  for (const e of elements) {
    if (!GAME_OFFER_TYPES.has(e.offerType ?? "") || /mystery game/i.test(e.title)) continue;
    const slug = epicPageSlug(e);
    if (!slug) continue;
    const offers = [
      ...(e.promotions?.promotionalOffers ?? []),
      ...(e.promotions?.upcomingPromotionalOffers ?? []),
    ].flatMap((p) => p.promotionalOffers);
    const images = new Map((e.keyImages ?? []).map((i) => [i.type, i.url]));
    for (const o of offers) {
      if (o.discountSetting?.discountPercentage !== 0) continue;
      const startsAt = new Date(o.startDate);
      const endsAt = new Date(o.endDate);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) continue;
      out.push({
        offerId: e.id,
        namespace: e.namespace,
        title: e.title.trim(),
        slug,
        description: e.description?.trim() || null,
        seller: e.seller?.name?.trim() || null,
        coverUrl: images.get("OfferImageTall") ?? images.get("DieselStoreFrontTall") ?? images.get("Thumbnail") ?? null,
        startsAt,
        endsAt,
      });
    }
  }
  return out;
}

export async function fetchFreeGames(): Promise<FreeGame[]> {
  const r = await fetch(`${FEED}?locale=en-US&country=US&allowCountries=US`);
  if (!r.ok) throw new Error(`Epic free games feed ${r.status}`);
  const j = (await r.json()) as { data?: { Catalog?: { searchStore?: { elements?: FeedElement[] } } } };
  const elements = j.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) throw new Error("Epic free games feed: unexpected shape");
  return parseFreeGames(elements);
}
