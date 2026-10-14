// IsThereAnyDeal implementation. Limits: 1000 requests / 5 min; prices/v3 accepts 200 ids per call.
import type { PriceProvider, PriceQuote, ShopCode } from "./provider";

const BASE = "https://api.isthereanydeal.com";
const SHOP_IDS: Record<number, ShopCode> = { 61: "steam", 16: "epic" };
const SHOPS_PARAM = "61,16";

type Money = { amountInt: number; currency: string };

async function call<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${path}${sep}key=${process.env.ITAD_API_KEY}`, init);
  if (r.status === 429 && attempt < 3) {
    const wait = Number(r.headers.get("retry-after") ?? 5) * 1000;
    await new Promise((res) => setTimeout(res, wait));
    return call(path, init, attempt + 1);
  }
  if (!r.ok) throw new Error(`ITAD ${path.split("?")[0]} ${r.status}`);
  return r.json();
}

export const itadProvider: PriceProvider = {
  name: "isthereanydeal",

  async getPrices(ids, country) {
    const out: PriceQuote[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const data = await call<{ id: string; deals: { shop: { id: number }; price: Money; regular: Money; storeLow: Money | null; expiry: string | null }[] }[]>(
        `/games/prices/v3?country=${country}&shops=${SHOPS_PARAM}&deals=false`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids.slice(i, i + 200)) },
      );
      for (const entry of data) {
        for (const d of entry.deals ?? []) {
          const shop = SHOP_IDS[d.shop.id];
          if (!shop) continue;
          out.push({
            providerGameId: entry.id,
            shop,
            currency: d.price.currency,
            priceCents: d.price.amountInt,
            regularCents: d.regular.amountInt,
            storeLowCents: d.storeLow?.amountInt ?? null,
            saleEndsAt: d.expiry,
          });
        }
      }
    }
    return out;
  },

  async getHistory(id, country, since) {
    const data = await call<{ timestamp: string; shop: { id: number }; deal: { price: Money; regular: Money } }[]>(
      `/games/history/v2?id=${id}&country=${country}&shops=${SHOPS_PARAM}&since=${encodeURIComponent(since.toISOString())}`,
    );
    return data
      .filter((h) => SHOP_IDS[h.shop.id])
      .map((h) => ({
        shop: SHOP_IDS[h.shop.id],
        timestamp: h.timestamp,
        currency: h.deal.price.currency,
        priceCents: h.deal.price.amountInt,
        regularCents: h.deal.regular.amountInt,
      }));
  },
};
