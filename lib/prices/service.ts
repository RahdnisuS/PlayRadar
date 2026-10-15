// Price storage rules on top of a PriceProvider:
//  * a price_snapshots row is written only when a listing's price changes
//  * price_summary keeps the latest price, all-time low and 12-month sale count per (listing, country)
//  * price_fetch_state drives the on-demand TTL cache
import { q } from "../db";
import { itadProvider } from "./itad";
import type { PricePoint, PriceProvider, PriceQuote, ShopCode } from "./provider";
import { steamStorePrices } from "./steamStore";
import { CURRENCY_BY_COUNTRY } from "../search/filters";

export const PRICE_TTL_HOURS = 6;
const provider: PriceProvider = itadProvider;

type Listing = { listing_id: string; game_id: string; itad_id: string | null; shop: ShopCode; store_app_id: string };

async function listingsFor(gameIds: (string | number)[]): Promise<Listing[]> {
  return q<Listing>(
    `SELECT sl.id AS listing_id, sl.game_id, g.itad_id, s.code AS shop, sl.store_app_id
     FROM store_listings sl JOIN stores s ON s.id = sl.store_id JOIN games g ON g.id = sl.game_id
     WHERE sl.game_id = ANY($1::bigint[])`,
    [gameIds],
  );
}

/** Steam listings the primary provider didn't price: ask Steam's storefront directly (no history, no sale end). */
async function steamFallbackQuotes(listings: Listing[], country: string): Promise<Map<string, PriceQuote>> {
  const out = new Map<string, PriceQuote>();
  if (!listings.length) return out;
  const prices = await steamStorePrices(listings.map((l) => l.store_app_id), country);
  const currency = CURRENCY_BY_COUNTRY[country]?.code ?? "USD";
  for (const l of listings) {
    const p = prices.get(l.store_app_id);
    if (!p) continue;
    out.set(l.listing_id, {
      providerGameId: l.itad_id ?? `steam:${l.store_app_id}`,
      shop: "steam",
      currency: p.currency || currency,
      priceCents: p.priceCents,
      regularCents: p.regularCents,
      storeLowCents: null,
      saleEndsAt: null,
    });
  }
  return out;
}

/** Inserts a snapshot only if price or regular price differs from the latest one. Returns the new snapshot id, if any. */
async function insertSnapshotIfChanged(listingId: string, country: string, p: { currency: string; priceCents: number; regularCents: number; saleEndsAt?: string | null; capturedAt?: string }) {
  const rows = await q<{ id: string }>(
    `INSERT INTO price_snapshots (listing_id, country_code, currency, price_cents, regular_cents, sale_ends_at, captured_at)
     SELECT $1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now())
     WHERE NOT EXISTS (
       SELECT 1 FROM (
         SELECT price_cents, regular_cents FROM price_snapshots
         WHERE listing_id = $1 AND country_code = $2 AND captured_at <= COALESCE($7::timestamptz, now())
         ORDER BY captured_at DESC LIMIT 1
       ) last WHERE last.price_cents = $4 AND last.regular_cents = $5
     )
     RETURNING id`,
    [listingId, country, p.currency, p.priceCents, p.regularCents, p.saleEndsAt ?? null, p.capturedAt ?? null],
  );
  return rows[0]?.id ?? null;
}

/** Recomputes the summary from snapshots (sale count = number of times a discount started in the last 12 months). */
async function refreshSummary(listingId: string, country: string, current: PriceQuote | null, storeLowCents: number | null) {
  await q(
    `WITH s AS (
       SELECT price_cents, regular_cents, discount_pct, captured_at,
              LAG(discount_pct) OVER (ORDER BY captured_at) AS prev_pct
       FROM price_snapshots WHERE listing_id = $1 AND country_code = $2
     ), agg AS (
       SELECT MIN(price_cents) AS low, MIN(captured_at) AS since,
              COUNT(*) FILTER (WHERE discount_pct > 0 AND COALESCE(prev_pct, 0) = 0
                               AND captured_at > now() - interval '12 months') AS sales
       FROM s
     ), low_at AS (
       SELECT captured_at FROM s ORDER BY price_cents, captured_at DESC LIMIT 1
     ), latest AS (
       SELECT price_cents FROM s ORDER BY captured_at DESC LIMIT 1
     )
     INSERT INTO price_summary (listing_id, country_code, current_cents, lowest_cents, lowest_at, sale_count_12m, tracking_since, updated_at)
     SELECT $1, $2, COALESCE($3, latest.price_cents),
            LEAST(agg.low, COALESCE($4, agg.low)), low_at.captured_at, agg.sales, agg.since, now()
     FROM agg, latest, low_at
     ON CONFLICT (listing_id, country_code) DO UPDATE SET
       current_cents = EXCLUDED.current_cents, lowest_cents = EXCLUDED.lowest_cents, lowest_at = EXCLUDED.lowest_at,
       sale_count_12m = EXCLUDED.sale_count_12m,
       tracking_since = LEAST(price_summary.tracking_since, EXCLUDED.tracking_since), updated_at = now()`,
    [listingId, country, current?.priceCents ?? null, storeLowCents],
  );
}

async function markFetched(listingId: string, country: string, status: "ok" | "error" | "not_listed") {
  await q(
    `INSERT INTO price_fetch_state (listing_id, country_code, last_fetched_at, last_status) VALUES ($1, $2, now(), $3)
     ON CONFLICT (listing_id, country_code) DO UPDATE SET last_fetched_at = now(), last_status = EXCLUDED.last_status`,
    [listingId, country, status],
  );
}

/** Loads the last 12 months of history once per (listing, country) so charts and the wait/buy hint have data on day one. */
async function backfillHistory(listings: Listing[], country: string) {
  const byGame = new Map<string, Listing[]>();
  for (const l of listings) if (l.itad_id) byGame.set(l.itad_id, [...(byGame.get(l.itad_id) ?? []), l]);
  const since = new Date(Date.now() - 365 * 86400 * 1000);
  for (const [itadId, ls] of byGame) {
    const points: PricePoint[] = await provider.getHistory(itadId, country, since);
    points.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (const p of points) {
      const l = ls.find((x) => x.shop === p.shop);
      if (l) await insertSnapshotIfChanged(l.listing_id, country, { ...p, capturedAt: p.timestamp });
    }
  }
}

export type RefreshResult = { listings: number; changed: { listingId: string; snapshotId: string }[] };

/**
 * Fetches current prices for the given games in one country and stores them.
 * Listings with no summary yet also get their 12-month history backfilled.
 */
export async function refreshPrices(gameIds: (string | number)[], country: string, opts: { backfill?: boolean } = {}): Promise<RefreshResult> {
  const listings = await listingsFor(gameIds);
  if (listings.length === 0) return { listings: 0, changed: [] };

  let backfilled: Listing[] = [];
  if (opts.backfill !== false) {
    const done = new Set(
      (await q<{ listing_id: string }>(
        `SELECT listing_id FROM price_summary
         WHERE country_code = $2 AND listing_id = ANY($1::bigint[]) AND history_backfilled_at IS NOT NULL`,
        [listings.map((l) => l.listing_id), country],
      )).map((r) => r.listing_id),
    );
    backfilled = listings.filter((l) => l.itad_id && !done.has(l.listing_id));
    if (backfilled.length) await backfillHistory(backfilled, country);
  }

  const itadIds = [...new Set(listings.map((l) => l.itad_id).filter((id): id is string => !!id))];
  const quotes = itadIds.length ? await provider.getPrices(itadIds, country) : [];
  const primary = (l: Listing) => quotes.find((x) => x.providerGameId === l.itad_id && x.shop === l.shop) ?? null;
  const fallback = await steamFallbackQuotes(listings.filter((l) => l.shop === "steam" && !primary(l)), country);
  const changed: RefreshResult["changed"] = [];
  for (const l of listings) {
    const quote = primary(l) ?? fallback.get(l.listing_id) ?? null;
    if (!quote) {
      await markFetched(l.listing_id, country, "not_listed");
      continue;
    }
    const snapshotId = await insertSnapshotIfChanged(l.listing_id, country, quote);
    if (snapshotId) changed.push({ listingId: l.listing_id, snapshotId });
    await refreshSummary(l.listing_id, country, quote, quote.storeLowCents);
    await markFetched(l.listing_id, country, "ok");
  }
  if (backfilled.length) {
    await q(
      `UPDATE price_summary SET history_backfilled_at = now() WHERE country_code = $2 AND listing_id = ANY($1::bigint[])`,
      [backfilled.map((l) => l.listing_id), country],
    );
  }
  return { listings: listings.length, changed };
}

/**
 * On-demand path for the Buy popup: refresh if the cached prices are older than the TTL, or if a priced listing
 * still lacks its 12-month history (the daily catalog job skips the backfill).
 */
export async function ensureFreshPrices(gameId: string | number, country: string) {
  const stale = await q(
    `SELECT 1 FROM store_listings sl
     JOIN games g ON g.id = sl.game_id
     LEFT JOIN price_fetch_state f ON f.listing_id = sl.id AND f.country_code = $2
     LEFT JOIN price_summary ps ON ps.listing_id = sl.id AND ps.country_code = $2
     WHERE sl.game_id = $1
       AND (f.last_fetched_at IS NULL OR f.last_fetched_at < now() - make_interval(hours => $3)
            OR (g.itad_id IS NOT NULL AND ps.listing_id IS NOT NULL AND ps.history_backfilled_at IS NULL))
     LIMIT 1`,
    [gameId, country, PRICE_TTL_HOURS],
  );
  if (stale.length) await refreshPrices([gameId], country);
}
