// "Wait or buy?" advice for the cheapest store. Pure function so scripts/check-hint.ts can test it offline.
// Only given with at least MIN_HISTORY_MONTHS of history; otherwise the UI says tracking just started.
import { formatPrice } from "../format";

export const MIN_HISTORY_MONTHS = 6;

export type HintInput = {
  currency: string;
  priceCents: number;
  regularCents: number;
  allTimeLowCents: number | null;
  low12mCents: number | null; // lowest price seen in the last 12 months
  saleCount12m: number;
  historyMonths: number; // how far back our price history reaches
};

export type Hint = { verdict: "buy" | "wait" | "either" | "tracking"; text: string };

export function waitOrBuy(i: HintInput): Hint | null {
  if (i.regularCents === 0) return null; // free to play
  if (i.historyMonths < MIN_HISTORY_MONTHS) {
    return { verdict: "tracking", text: "We only just started tracking this price, so there's no wait-or-buy advice yet." };
  }
  const fmt = (c: number) => formatPrice(c, i.currency);
  const onSale = i.priceCents < i.regularCents;
  const low12 = i.low12mCents ?? i.priceCents;

  if (onSale) {
    if (i.allTimeLowCents != null && i.priceCents <= i.allTimeLowCents) {
      return { verdict: "buy", text: "Buy now: this is the lowest price it has ever been." };
    }
    if (i.priceCents <= low12) return { verdict: "buy", text: "Buy now: this matches its lowest price of the past year." };
    return { verdict: "either", text: `A decent discount, but it dropped to ${fmt(low12)} in the past year.` };
  }
  if (i.saleCount12m >= 2) {
    return {
      verdict: "wait",
      text: `Wait: it went on sale ${i.saleCount12m} times in the past year, as low as ${fmt(low12)}.`,
    };
  }
  if (i.saleCount12m === 1) {
    return { verdict: "wait", text: `Consider waiting: it was on sale once in the past year, down to ${fmt(low12)}.` };
  }
  return { verdict: "buy", text: "No discounts in the past year, so waiting probably won't save you anything." };
}
