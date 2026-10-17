// Finds due wishlist alerts and queues them in `notifications`. The (user_id, dedupe_key) unique index makes this
// idempotent: running it after every price refresh never queues the same alert twice.
import { q } from "../db";
import { dueAlerts, type Hit, type Snap } from "./rules";

// Users who can receive email: verified and not paused.
const RECIPIENT = `u.email_verified AND u.email_digest <> 'off'`;

type PairRow = {
  user_id: string;
  game_id: string;
  added_at: Date;
  target_price_cents: number | null;
  target_currency: string | null;
  alert_on_any_sale: boolean;
  alert_on_all_time_low: boolean;
  country_code: string;
  listing_id: string;
  lowest_cents: number | null;
  history_ready: boolean;
};

type SnapRow = {
  id: string;
  listing_id: string;
  country_code: string;
  currency: string;
  price_cents: number;
  regular_cents: number;
  captured_at: Date;
};

export type QueuedAlert = Hit & { userId: string; gameId: string; listingId: string; country: string; dedupeKey: string };

/** Price alerts (sale / all-time low / target) that are due right now, per wishlisted store listing. */
export async function findPriceAlerts(): Promise<QueuedAlert[]> {
  const pairs = await q<PairRow>(
    `SELECT w.user_id, w.game_id, w.added_at, w.target_price_cents, trim(w.target_currency) AS target_currency,
            w.alert_on_any_sale, w.alert_on_all_time_low, u.country_code, sl.id AS listing_id,
            ps.lowest_cents, ps.history_backfilled_at IS NOT NULL AS history_ready
     FROM wishlist_items w
     JOIN users u ON u.id = w.user_id
     JOIN store_listings sl ON sl.game_id = w.game_id
     LEFT JOIN price_summary ps ON ps.listing_id = sl.id AND ps.country_code = u.country_code
     WHERE ${RECIPIENT}
       AND (w.alert_on_any_sale OR w.alert_on_all_time_low OR w.target_price_cents IS NOT NULL)`,
  );
  if (!pairs.length) return [];

  const keys = [...new Set(pairs.map((p) => `${p.listing_id}|${p.country_code}`))].map((k) => k.split("|"));
  const snaps = await q<SnapRow>(
    `SELECT s.id, s.listing_id, s.country_code, s.currency, s.price_cents, s.regular_cents, s.captured_at
     FROM price_snapshots s
     JOIN unnest($1::bigint[], $2::text[]) AS k(listing_id, country_code)
       ON s.listing_id = k.listing_id AND s.country_code = k.country_code
     WHERE s.captured_at > now() - interval '400 days'
     ORDER BY s.captured_at`,
    [keys.map((k) => k[0]), keys.map((k) => k[1])],
  );
  const byKey = new Map<string, Snap[]>();
  for (const s of snaps) {
    const k = `${s.listing_id}|${s.country_code.trim()}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push({
      id: String(s.id),
      at: s.captured_at,
      currency: s.currency.trim(),
      priceCents: s.price_cents,
      regularCents: s.regular_cents,
    });
  }

  const out: QueuedAlert[] = [];
  for (const p of pairs) {
    const hits = dueAlerts(
      {
        addedAt: p.added_at,
        targetCents: p.target_price_cents,
        targetCurrency: p.target_currency,
        alertOnAnySale: p.alert_on_any_sale,
        alertOnAllTimeLow: p.alert_on_all_time_low,
      },
      { snaps: byKey.get(`${p.listing_id}|${p.country_code}`) ?? [], lowestCents: p.lowest_cents, historyReady: p.history_ready },
    );
    for (const h of hits) {
      const target = h.type === "target_hit" ? `:${p.target_price_cents}${p.target_currency}` : "";
      out.push({
        ...h,
        userId: p.user_id,
        gameId: String(p.game_id),
        listingId: String(p.listing_id),
        country: p.country_code,
        dedupeKey: `${h.type}:${p.listing_id}:${p.country_code}${target}:${h.episodeStart.id}`,
      });
    }
  }
  return out;
}

/** Queues price alerts and release alerts. Returns how many new notifications were queued. */
export async function queueAlerts(opts: { dry?: boolean } = {}): Promise<{ price: number; released: number; found: QueuedAlert[] }> {
  const found = await findPriceAlerts();
  if (opts.dry) return { price: found.length, released: 0, found };

  let price = 0;
  for (const a of found) {
    const rows = await q(
      `INSERT INTO notifications (user_id, game_id, snapshot_id, type, dedupe_key) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING 1`,
      [a.userId, a.gameId, a.latest.id, a.type, a.dedupeKey],
    );
    price += rows.length;
  }

  // Released / entered early access after the game was wishlisted (dates kept fresh by scripts/jobs/refresh-releases.ts).
  const released = await q(
    `INSERT INTO notifications (user_id, game_id, type, dedupe_key)
     SELECT w.user_id, w.game_id, 'released', 'released:' || w.game_id || ':' || g.release_status
     FROM wishlist_items w
     JOIN users u ON u.id = w.user_id
     JOIN games g ON g.id = w.game_id
     WHERE ${RECIPIENT} AND w.alert_on_release AND (
       (g.release_status = 'released' AND g.release_date BETWEEN w.added_at::date AND current_date)
       OR (g.release_status = 'early_access'
           AND COALESCE(g.early_access_date, g.release_date) BETWEEN w.added_at::date AND current_date))
     ON CONFLICT (user_id, dedupe_key) DO NOTHING
     RETURNING 1`,
  );
  return { price, released: released.length, found };
}
