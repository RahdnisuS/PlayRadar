// Fallback for Steam listings IsThereAnyDeal doesn't price: Steam's public storefront API (no key, regional via cc).
// Batch price lookups are allowed with filters=price_overview. An empty result means either free-to-play or
// not purchasable; a per-app "basic" lookup tells those apart. No history or sale end dates from this source.

export type SteamPrice = { currency: string; priceCents: number; regularCents: number };

const BASE = "https://store.steampowered.com/api/appdetails";
const BATCH = 50;

async function get(url: string): Promise<Record<string, { success: boolean; data?: unknown }> | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Returns a price for each purchasable or free app; apps missing from the map aren't sold in that country. */
export async function steamStorePrices(appids: string[], country: string): Promise<Map<string, SteamPrice>> {
  const out = new Map<string, SteamPrice>();
  const empty: string[] = [];
  for (let i = 0; i < appids.length; i += BATCH) {
    const chunk = appids.slice(i, i + BATCH);
    const data = await get(`${BASE}?appids=${chunk.join(",")}&cc=${country.toLowerCase()}&filters=price_overview`);
    if (!data) continue;
    for (const id of chunk) {
      const entry = data[id];
      if (!entry?.success) continue;
      const po = (entry.data as { price_overview?: { currency: string; initial: number; final: number } })?.price_overview;
      if (po) out.set(id, { currency: po.currency, priceCents: po.final, regularCents: po.initial });
      else empty.push(id);
    }
  }
  for (const id of empty) {
    const data = await get(`${BASE}?appids=${id}&cc=${country.toLowerCase()}&filters=basic`);
    const basic = data?.[id]?.data as { is_free?: boolean } | undefined;
    if (basic?.is_free) out.set(id, { currency: "", priceCents: 0, regularCents: 0 });
  }
  return out;
}
