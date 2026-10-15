// Everything the Buy popup needs for one game in one region: per-store prices (cheapest first),
// all-time lows, 12-month history and the wait-or-buy hint for the cheapest store.
import { q } from "../db";
import { waitOrBuy, type Hint } from "./hint";
import type { ShopCode } from "./provider";

export type StorePrice = {
  shop: ShopCode;
  name: string;
  url: string;
  appLink: string | null;
  priceCents: number | null; // null: not sold in this region / no price found
  regularCents: number | null;
  currency: string | null;
  discountPct: number;
  saleEndsAt: string | null;
  lowestCents: number | null;
  lowestAt: string | null;
  isAllTimeLow: boolean;
};

export type HistoryPoint = { shop: ShopCode; at: string; priceCents: number };

export type PriceDetails = {
  country: string;
  releaseStatus: string;
  stores: StorePrice[];
  history: HistoryPoint[];
  historySince: string | null; // how far back our history reaches
  hint: Hint | null;
};

type Row = {
  shop: ShopCode;
  name: string;
  store_url: string;
  steam_app_link: string | null;
  current_cents: number | null;
  lowest_cents: number | null;
  lowest_at: string | null;
  sale_count_12m: number | null;
  tracking_since: string | null;
  history_backfilled_at: string | null;
  regular_cents: number | null;
  currency: string | null;
  sale_ends_at: string | null;
  low_12m: number | null;
};

export async function getPriceDetails(gameId: string, country: string): Promise<PriceDetails | null> {
  const [game] = await q<{ release_status: string }>(`SELECT release_status FROM games WHERE id = $1`, [gameId]);
  if (!game) return null;

  const rows = await q<Row>(
    `SELECT s.code AS shop, s.name, sl.store_url, sl.steam_app_link,
            ps.current_cents, ps.lowest_cents, ps.lowest_at, ps.sale_count_12m, ps.tracking_since, ps.history_backfilled_at,
            last.regular_cents, last.currency, last.sale_ends_at, low.low_12m
     FROM store_listings sl
     JOIN stores s ON s.id = sl.store_id
     LEFT JOIN price_summary ps ON ps.listing_id = sl.id AND ps.country_code = $2
     LEFT JOIN LATERAL (SELECT regular_cents, currency, sale_ends_at FROM price_snapshots
                        WHERE listing_id = sl.id AND country_code = $2 ORDER BY captured_at DESC LIMIT 1) last ON true
     LEFT JOIN LATERAL (SELECT MIN(price_cents) AS low_12m FROM price_snapshots
                        WHERE listing_id = sl.id AND country_code = $2 AND captured_at > now() - interval '12 months') low ON true
     WHERE sl.game_id = $1`,
    [gameId, country],
  );

  const stores: StorePrice[] = rows
    .map((r) => {
      const priced = r.current_cents != null && r.currency != null;
      const regular = priced ? Math.max(r.regular_cents ?? r.current_cents!, r.current_cents!) : null;
      const discountPct = priced && regular ? Math.round(((regular - r.current_cents!) / regular) * 100) : 0;
      const saleEnds = r.sale_ends_at && new Date(r.sale_ends_at) > new Date() && discountPct > 0 ? r.sale_ends_at : null;
      return {
        shop: r.shop,
        name: r.name,
        url: r.store_url,
        appLink: r.steam_app_link,
        priceCents: priced ? r.current_cents : null,
        regularCents: regular,
        currency: priced ? r.currency : null,
        discountPct,
        saleEndsAt: saleEnds,
        lowestCents: priced ? r.lowest_cents : null,
        lowestAt: priced ? r.lowest_at : null,
        isAllTimeLow: priced && discountPct > 0 && r.lowest_cents != null && r.current_cents! <= r.lowest_cents,
      };
    })
    .sort((a, b) => (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity) || a.shop.localeCompare(b.shop));

  const history = await q<HistoryPoint>(
    `SELECT s.code AS shop, ps.captured_at AS at, ps.price_cents AS "priceCents"
     FROM price_snapshots ps
     JOIN store_listings sl ON sl.id = ps.listing_id JOIN stores s ON s.id = sl.store_id
     WHERE sl.game_id = $1 AND ps.country_code = $2 AND ps.captured_at > now() - interval '12 months'
     ORDER BY ps.captured_at`,
    [gameId, country],
  );

  // A backfilled listing has a full year of history even if the price never changed in it.
  const sinceOf = (r: Row) =>
    r.history_backfilled_at
      ? new Date(new Date(r.history_backfilled_at).getTime() - 365 * 86400_000)
      : r.tracking_since
        ? new Date(r.tracking_since)
        : null;

  const cheapest = stores[0];
  const cheapestRow = cheapest && rows.find((r) => r.shop === cheapest.shop);
  let hint: Hint | null = null;
  let historySince: Date | null = null;
  for (const r of rows) {
    const s = sinceOf(r);
    if (s && (!historySince || s < historySince)) historySince = s;
  }
  if (cheapest?.priceCents != null && cheapestRow) {
    const since = sinceOf(cheapestRow);
    hint = waitOrBuy({
      currency: cheapest.currency!,
      priceCents: cheapest.priceCents,
      regularCents: cheapest.regularCents ?? cheapest.priceCents,
      allTimeLowCents: cheapest.lowestCents,
      low12mCents: cheapestRow.low_12m,
      saleCount12m: cheapestRow.sale_count_12m ?? 0,
      historyMonths: since ? (Date.now() - since.getTime()) / (30.44 * 86400_000) : 0,
    });
  }

  return {
    country,
    releaseStatus: game.release_status,
    stores,
    history: history.map((h) => ({ ...h, at: new Date(h.at).toISOString() })),
    historySince: historySince?.toISOString() ?? null,
    hint,
  };
}
