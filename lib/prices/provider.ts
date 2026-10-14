// Price source abstraction so IsThereAnyDeal can be swapped for another provider.
// All amounts are integer minor units (cents/paise) in the store's native currency for that country.

export type ShopCode = "steam" | "epic";

export interface PriceQuote {
  providerGameId: string;
  shop: ShopCode;
  currency: string;
  priceCents: number;
  regularCents: number;
  storeLowCents: number | null; // all-time low at this store, in this country
  saleEndsAt: string | null;
}

export interface PricePoint {
  shop: ShopCode;
  timestamp: string;
  currency: string;
  priceCents: number;
  regularCents: number;
}

export interface PriceProvider {
  readonly name: string;
  getPrices(providerGameIds: string[], country: string): Promise<PriceQuote[]>;
  getHistory(providerGameId: string, country: string, since: Date): Promise<PricePoint[]>;
}
