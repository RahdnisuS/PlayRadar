// Pure alert rules (no DB). Each alert belongs to an "episode": the trailing run of snapshots in which its condition
// holds. The episode's first snapshot goes into the dedupe key, so one sale / one dip below target alerts once.

export type Snap = { id: string; at: Date; currency: string; priceCents: number; regularCents: number };
export type AlertType = "sale" | "all_time_low" | "target_hit";

export type WishlistRule = {
  addedAt: Date;
  targetCents: number | null;
  targetCurrency: string | null;
  alertOnAnySale: boolean;
  alertOnAllTimeLow: boolean;
};

export type ListingState = {
  snaps: Snap[]; // ascending by time
  lowestCents: number | null; // price_summary.lowest_cents (includes the provider's store low)
  historyReady: boolean; // 12-month history backfilled, so "all-time low" means something
};

export type Hit = { type: AlertType; episodeStart: Snap; latest: Snap };

export const onSale = (s: Snap) => s.regularCents > 0 && s.priceCents < s.regularCents;

/** First snapshot of the trailing run where cond holds, or null when the latest snapshot fails it. */
export function episodeStart(snaps: Snap[], cond: (s: Snap) => boolean): Snap | null {
  let i = snaps.length - 1;
  if (i < 0 || !cond(snaps[i])) return null;
  while (i > 0 && cond(snaps[i - 1])) i--;
  return snaps[i];
}

export const isAllTimeLow = (s: Snap, lowestCents: number | null) => onSale(s) && lowestCents != null && s.priceCents <= lowestCents;
export const meetsTarget = (s: Snap, w: Pick<WishlistRule, "targetCents" | "targetCurrency">) =>
  w.targetCents != null && s.currency === w.targetCurrency && s.priceCents <= w.targetCents;

/** Which alerts are due for one wishlisted listing. Only episodes that started after the game was added count. */
export function dueAlerts(w: WishlistRule, l: ListingState): Hit[] {
  const latest = l.snaps[l.snaps.length - 1];
  if (!latest) return [];
  const out: Hit[] = [];
  const add = (type: AlertType, start: Snap | null) => {
    if (start && start.at > w.addedAt) out.push({ type, episodeStart: start, latest });
  };

  if (w.alertOnAnySale) add("sale", episodeStart(l.snaps, onSale));
  if (w.alertOnAllTimeLow && l.historyReady) {
    // Within the current sale, the first snapshot that reached the low (a sale can deepen into an all-time low).
    const sale = episodeStart(l.snaps, onSale);
    if (sale && isAllTimeLow(latest, l.lowestCents)) {
      const run = l.snaps.slice(l.snaps.indexOf(sale));
      add("all_time_low", run.find((s) => s.priceCents <= l.lowestCents!) ?? null);
    }
  }
  if (w.targetCents != null) add("target_hit", episodeStart(l.snaps, (s) => meetsTarget(s, w)));
  return out;
}

/** Re-check at send time: drop alerts whose condition no longer holds (sale ended, price went back up). */
export function stillValid(type: AlertType | "released", latest: Snap | null, w: WishlistRule, lowestCents: number | null): boolean {
  if (type === "released") return true;
  if (!latest) return false;
  if (type === "sale") return onSale(latest);
  if (type === "all_time_low") return isAllTimeLow(latest, lowestCents);
  return meetsTarget(latest, w);
}
