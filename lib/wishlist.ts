// Wishlist storage. The wishlist lives only in our DB; it never touches the user's Steam or Epic wishlist.
// Target prices are stored in the currency of the user's region at the time they were set.
import { q } from "./db";

export const MAX_WISHLIST_ITEMS = 200; // bounds the scheduled price-polling set per user

export type WishlistSettings = {
  targetCents: number | null;
  targetCurrency: string | null;
  alertOnAnySale: boolean;
  alertOnAllTimeLow: boolean;
  alertOnRelease: boolean;
};

export type WishlistItem = WishlistSettings & {
  gameId: string;
  title: string;
  coverUrl: string | null;
  releaseStatus: "released" | "upcoming" | "early_access";
  releaseDate: string | null;
  addedAt: string;
  // Cheapest current price in the user's region (null: no price yet / not sold there).
  priceCents: number | null;
  regularCents: number | null;
  lowestCents: number | null;
  currency: string | null;
};

type SettingsRow = {
  target_price_cents: number | null;
  target_currency: string | null;
  alert_on_any_sale: boolean;
  alert_on_all_time_low: boolean;
  alert_on_release: boolean;
};

const toSettings = (r: SettingsRow): WishlistSettings => ({
  targetCents: r.target_price_cents,
  targetCurrency: r.target_currency?.trim() ?? null,
  alertOnAnySale: r.alert_on_any_sale,
  alertOnAllTimeLow: r.alert_on_all_time_low,
  alertOnRelease: r.alert_on_release,
});

export async function listWishlist(userId: string, country: string): Promise<WishlistItem[]> {
  const rows = await q<
    SettingsRow & {
      game_id: string;
      title: string;
      cover_url: string | null;
      release_status: WishlistItem["releaseStatus"];
      release_date: string | null;
      added_at: string;
      current_cents: number | null;
      regular_cents: number | null;
      lowest_cents: number | null;
      currency: string | null;
    }
  >(
    `SELECT w.game_id, g.title, g.cover_url, g.release_status, g.release_date::text, w.added_at,
            w.target_price_cents, w.target_currency, w.alert_on_any_sale, w.alert_on_all_time_low, w.alert_on_release,
            p.current_cents, p.regular_cents, p.lowest_cents, p.currency
     FROM wishlist_items w
     JOIN games g ON g.id = w.game_id
     LEFT JOIN LATERAL (
       SELECT ps.current_cents, ps.lowest_cents, s.regular_cents, s.currency
       FROM store_listings sl
       JOIN price_summary ps ON ps.listing_id = sl.id AND ps.country_code = $2
       LEFT JOIN LATERAL (SELECT regular_cents, currency FROM price_snapshots
                          WHERE listing_id = sl.id AND country_code = $2 ORDER BY captured_at DESC LIMIT 1) s ON true
       WHERE sl.game_id = g.id ORDER BY ps.current_cents LIMIT 1
     ) p ON true
     WHERE w.user_id = $1
     ORDER BY w.added_at DESC`,
    [userId, country],
  );
  return rows.map((r) => ({
    ...toSettings(r),
    gameId: String(r.game_id),
    title: r.title,
    coverUrl: r.cover_url,
    releaseStatus: r.release_status,
    releaseDate: r.release_date,
    addedAt: r.added_at,
    priceCents: r.current_cents,
    regularCents: r.regular_cents,
    lowestCents: r.lowest_cents,
    currency: r.currency,
  }));
}

export async function getWishlistItem(userId: string, gameId: string): Promise<WishlistSettings | null> {
  const [row] = await q<SettingsRow>(
    `SELECT target_price_cents, target_currency, alert_on_any_sale, alert_on_all_time_low, alert_on_release
     FROM wishlist_items WHERE user_id = $1 AND game_id = $2`,
    [userId, gameId],
  );
  return row ? toSettings(row) : null;
}

export type SaveResult = "saved" | "no_game" | "full";

/** Adds or updates one item. A null target clears it (and its currency). */
export async function saveWishlistItem(
  userId: string,
  gameId: string,
  s: WishlistSettings,
  source: "site" | "chat",
): Promise<SaveResult> {
  const rows = await q<{ status: string }>(
    `WITH g AS (SELECT id FROM games WHERE id = $2),
     room AS (
       SELECT EXISTS (SELECT 1 FROM wishlist_items WHERE user_id = $1 AND game_id = $2)
              OR (SELECT count(*) FROM wishlist_items WHERE user_id = $1) < $9 AS ok
     ),
     ins AS (
       INSERT INTO wishlist_items (user_id, game_id, target_price_cents, target_currency,
                                   alert_on_any_sale, alert_on_all_time_low, alert_on_release, source)
       SELECT $1, g.id, $3, CASE WHEN $3::int IS NULL THEN NULL ELSE $4 END, $5, $6, $7, $8
       FROM g, room WHERE room.ok
       ON CONFLICT (user_id, game_id) DO UPDATE SET
         target_price_cents = EXCLUDED.target_price_cents, target_currency = EXCLUDED.target_currency,
         alert_on_any_sale = EXCLUDED.alert_on_any_sale, alert_on_all_time_low = EXCLUDED.alert_on_all_time_low,
         alert_on_release = EXCLUDED.alert_on_release
       RETURNING 1
     )
     SELECT CASE WHEN EXISTS (SELECT 1 FROM ins) THEN 'saved'
                 WHEN NOT EXISTS (SELECT 1 FROM g) THEN 'no_game' ELSE 'full' END AS status`,
    [
      userId,
      gameId,
      s.targetCents,
      s.targetCurrency,
      s.alertOnAnySale,
      s.alertOnAllTimeLow,
      s.alertOnRelease,
      source,
      MAX_WISHLIST_ITEMS,
    ],
  );
  return rows[0].status as SaveResult;
}

export async function removeWishlistItem(userId: string, gameId: string): Promise<boolean> {
  const rows = await q(`DELETE FROM wishlist_items WHERE user_id = $1 AND game_id = $2 RETURNING 1`, [userId, gameId]);
  return rows.length > 0;
}
