// Sends queued wishlist alerts: one email per user per run (instant users every run, daily/weekly users from the
// digest job). Each alert is re-checked first; an alert whose sale ended or whose price went back up is dropped
// (status 'failed' = not sent). Emails show the latest price. The daily email cap leaves the rest queued.
import { q } from "../db";
import { EmailError, sendEmail } from "../email/brevo";
import { renderEmail, type AlertKind, type EmailItem } from "./email";
import { stillValid, type Snap } from "./rules";

export const ALERT_EMAILS_PER_DAY = 200; // Brevo allows 300/day; the rest is for sign-in emails
const MAX_QUEUE_DAYS = 14;
const MAX_ITEMS_PER_EMAIL = 20;

export type Digest = "instant" | "daily" | "weekly";

type QueuedRow = {
  id: string;
  user_id: string;
  game_id: string;
  type: AlertKind;
  email: string;
  unsubscribe_token: string;
  country_code: string;
  email_digest: Digest | "off";
  free_game_alerts: boolean;
  promo_ends_at: Date | null;
  title: string;
  cover_url: string | null;
  release_status: string;
  on_list: boolean;
  added_at: Date | null;
  target_price_cents: number | null;
  target_currency: string | null;
  alert_on_any_sale: boolean | null;
  alert_on_all_time_low: boolean | null;
  snap_listing: string | null;
  snap_country: string | null;
};

type ListingRow = {
  listing_id: string;
  game_id: string;
  country_code: string;
  store_code: string;
  store_name: string;
  store_url: string;
  lowest_cents: number | null;
  snap_id: string | null;
  currency: string | null;
  price_cents: number | null;
  regular_cents: number | null;
  sale_ends_at: Date | null;
  captured_at: Date | null;
};

const latestSnap = (l: ListingRow | undefined): Snap | null =>
  l?.snap_id && l.currency && l.price_cents != null && l.regular_cents != null && l.captured_at
    ? { id: String(l.snap_id), at: l.captured_at, currency: l.currency.trim(), priceCents: l.price_cents, regularCents: l.regular_cents }
    : null;

export type SendResult = { emails: number; sent: number; dropped: number; leftQueued: number; failed: number };

export async function sendQueuedAlerts(digests: Digest[], opts: { dry?: boolean; siteUrl: string; preview?: (to: string, html: string) => void }): Promise<SendResult> {
  if (!opts.dry) {
    // Paused / unverified users and very old alerts are never sent. Free-game alerts have their own switch.
    await q(
      `UPDATE notifications n SET status = 'failed' FROM users u
       WHERE n.user_id = u.id AND n.status = 'queued'
         AND (NOT u.email_verified OR n.created_at < now() - make_interval(days => $1)
              OR (n.type <> 'free_to_claim' AND u.email_digest = 'off')
              OR (n.type = 'free_to_claim' AND NOT u.free_game_alerts))`,
      [MAX_QUEUE_DAYS],
    );
  }

  // Free-game alerts go out on every run, whatever the digest setting: a giveaway only lasts about a week.
  const rows = await q<QueuedRow>(
    `SELECT n.id, n.user_id, n.game_id, n.type, u.email, u.unsubscribe_token, trim(u.country_code) AS country_code, u.email_digest,
            u.free_game_alerts, fp.ends_at AS promo_ends_at,
            g.title, g.cover_url, g.release_status,
            w.user_id IS NOT NULL AS on_list, w.added_at, w.target_price_cents, trim(w.target_currency) AS target_currency,
            w.alert_on_any_sale, w.alert_on_all_time_low,
            sn.listing_id AS snap_listing, trim(sn.country_code) AS snap_country
     FROM notifications n
     JOIN users u ON u.id = n.user_id
     JOIN games g ON g.id = n.game_id
     LEFT JOIN wishlist_items w ON w.user_id = n.user_id AND w.game_id = n.game_id
     LEFT JOIN price_snapshots sn ON sn.id = n.snapshot_id
     LEFT JOIN free_promotions fp ON fp.id = n.promo_id
     WHERE n.status = 'queued' AND u.email_verified
       AND (u.email_digest = ANY($1::text[]) OR n.type = 'free_to_claim')
     ORDER BY n.created_at`,
    [digests],
  );
  const result: SendResult = { emails: 0, sent: 0, dropped: 0, leftQueued: 0, failed: 0 };
  if (!rows.length) return result;

  // Current prices for every game involved, in each user's region.
  const pairs = [...new Set(rows.map((r) => `${r.game_id}|${r.country_code}`))].map((k) => k.split("|"));
  const listings = await q<ListingRow>(
    `SELECT sl.id AS listing_id, sl.game_id, k.country_code, s.code AS store_code, s.name AS store_name, sl.store_url, ps.lowest_cents,
            last.id AS snap_id, last.currency, last.price_cents, last.regular_cents, last.sale_ends_at, last.captured_at
     FROM unnest($1::bigint[], $2::text[]) AS k(game_id, country_code)
     JOIN store_listings sl ON sl.game_id = k.game_id
     JOIN stores s ON s.id = sl.store_id
     LEFT JOIN price_summary ps ON ps.listing_id = sl.id AND ps.country_code = k.country_code
     LEFT JOIN LATERAL (SELECT id, currency, price_cents, regular_cents, sale_ends_at, captured_at FROM price_snapshots
                        WHERE listing_id = sl.id AND country_code = k.country_code ORDER BY captured_at DESC LIMIT 1) last ON true`,
    [pairs.map((p) => p[0]), pairs.map((p) => p[1])],
  );
  const listingKey = (listingId: string | number, country: string) => `${listingId}|${country}`;
  const byListing = new Map(listings.map((l) => [listingKey(l.listing_id, l.country_code), l]));
  const cheapest = (gameId: string, country: string) =>
    listings
      .filter((l) => String(l.game_id) === String(gameId) && l.country_code === country && l.price_cents != null)
      .sort((a, b) => a.price_cents! - b.price_cents!)[0];

  const drop: string[] = [];
  // user -> item key -> item + the notifications it covers (with the snapshot shown)
  type Entry = { item: EmailItem; ids: { id: string; snap: string | null }[] };
  const perUser = new Map<string, { email: string; token: string; country: string; digest: Digest | "off"; entries: Map<string, Entry> }>();

  for (const r of rows) {
    let listing: ListingRow | undefined;
    let valid = r.on_list;
    if (r.type === "free_to_claim") {
      // Not about the wishlist: still running and still wanted. Shown with the Epic listing's regular price.
      valid = r.free_game_alerts && !!r.promo_ends_at && r.promo_ends_at > new Date();
      listing = listings.find((l) => String(l.game_id) === String(r.game_id) && l.country_code === r.country_code && l.store_code === "epic");
    } else if (valid && r.type !== "released") {
      // A price alert is about one store listing in one region; a region change since queuing makes it moot.
      listing = r.snap_country === r.country_code ? byListing.get(listingKey(r.snap_listing!, r.country_code)) : undefined;
      const flagOn = r.type === "sale" ? r.alert_on_any_sale : r.type === "all_time_low" ? r.alert_on_all_time_low : true;
      valid =
        !!listing &&
        !!flagOn &&
        stillValid(
          r.type,
          latestSnap(listing),
          {
            addedAt: r.added_at!,
            targetCents: r.target_price_cents,
            targetCurrency: r.target_currency,
            alertOnAnySale: !!r.alert_on_any_sale,
            alertOnAllTimeLow: !!r.alert_on_all_time_low,
          },
          listing.lowest_cents,
        );
    } else if (valid) {
      listing = cheapest(r.game_id, r.country_code);
    }
    if (!valid) {
      drop.push(r.id);
      continue;
    }

    if (!perUser.has(r.user_id)) {
      perUser.set(r.user_id, { email: r.email, token: r.unsubscribe_token, country: r.country_code, digest: r.email_digest, entries: new Map() });
    }
    const u = perUser.get(r.user_id)!;
    const free = r.type === "free_to_claim";
    const key = `${free ? "free" : r.game_id}|${free ? r.game_id : listing?.listing_id ?? "none"}`;
    const snap = latestSnap(listing);
    // The giveaway price is 0 whatever the last snapshot says; the regular price shows what it's worth.
    const regular = free ? (snap && snap.regularCents > 0 ? snap.regularCents : null) : snap?.regularCents ?? null;
    if (!u.entries.has(key)) {
      u.entries.set(key, {
        item: {
          title: r.title,
          coverUrl: r.cover_url,
          kinds: [],
          releaseStatus: r.release_status,
          storeName: listing?.store_name ?? null,
          storeUrl: listing?.store_url ?? null,
          priceCents: free ? 0 : snap?.priceCents ?? null,
          regularCents: regular,
          currency: free && regular == null ? null : snap?.currency ?? null,
          saleEndsAt: free
            ? r.promo_ends_at
            : listing?.sale_ends_at && listing.sale_ends_at > new Date() ? listing.sale_ends_at : null,
          targetCents: r.target_price_cents,
          targetCurrency: r.target_currency,
        },
        ids: [],
      });
    }
    const e = u.entries.get(key)!;
    if (!e.item.kinds.includes(r.type)) e.item.kinds.push(r.type);
    e.ids.push({ id: r.id, snap: r.type === "released" || free ? null : snap?.id ?? null });
  }

  if (drop.length && !opts.dry) await q(`UPDATE notifications SET status = 'failed' WHERE id = ANY($1::bigint[])`, [drop]);
  result.dropped = drop.length;

  let capReached = false;
  for (const u of perUser.values()) {
    // Very long lists go out over several runs.
    const all = [...u.entries.values()];
    const entries = all.slice(0, MAX_ITEMS_PER_EMAIL);
    result.leftQueued += all.slice(MAX_ITEMS_PER_EMAIL).reduce((n, e) => n + e.ids.length, 0);
    const ids = entries.flatMap((e) => e.ids);
    if (capReached) {
      result.leftQueued += ids.length;
      continue;
    }
    const unsubscribeUrl = `${opts.siteUrl}/unsubscribe?token=${encodeURIComponent(u.token)}`;
    const mail = renderEmail(
      entries.map((e) => e.item),
      { siteUrl: opts.siteUrl, unsubscribeUrl, country: u.country, digest: u.digest },
    );
    if (opts.dry) {
      console.log(`  would email ${u.email.replace(/^(.).*@/, "$1***@")}: ${mail.subject}`);
      opts.preview?.(u.email, mail.html);
      result.emails++;
      result.sent += ids.length;
      continue;
    }

    const [{ ok }] = await q<{ ok: boolean }>(`SELECT try_consume_email($1) AS ok`, [ALERT_EMAILS_PER_DAY]);
    if (!ok) {
      capReached = true;
      result.leftQueued += ids.length;
      continue;
    }
    try {
      await sendEmail({
        to: u.email,
        ...mail,
        headers: {
          "List-Unsubscribe": `<${opts.siteUrl}/api/unsubscribe?token=${encodeURIComponent(u.token)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      await q(
        `UPDATE notifications n SET status = 'sent', sent_at = now(), snapshot_id = COALESCE(x.snap, n.snapshot_id)
         FROM unnest($1::bigint[], $2::bigint[]) AS x(id, snap) WHERE n.id = x.id`,
        [ids.map((i) => i.id), ids.map((i) => i.snap)],
      );
      result.emails++;
      result.sent += ids.length;
    } catch (err) {
      console.error(`  email failed: ${(err as Error).message}`);
      if (err instanceof EmailError && err.permanent) {
        await q(`UPDATE notifications SET status = 'failed' WHERE id = ANY($1::bigint[])`, [ids.map((i) => i.id)]);
        result.failed += ids.length;
      } else {
        result.leftQueued += ids.length;
      }
    }
  }
  return result;
}
