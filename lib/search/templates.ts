// Templated "why this fits" lines built from facts we have, used when the LLM is unavailable or capped.
import { formatPrice } from "../format";

export type ReasonFacts = {
  title: string;
  matched_tags: string[];
  moods: string[];
  is_coop: boolean | null;
  avg_playtime_hrs: number | null;
  price_cents: number | null;
  currency: string | null;
  release_status: string;
};

export function templateReason(g: ReasonFacts): string {
  const parts: string[] = [];
  const tags = g.matched_tags.length ? g.matched_tags : g.moods;
  if (tags.length) parts.push(`${g.matched_tags.length ? "Matches" : "Feels"} ${tags.slice(0, 3).join(", ").toLowerCase()}`);
  if (g.is_coop) parts.push("plays co-op");
  if (g.avg_playtime_hrs) parts.push(`about ${Math.round(g.avg_playtime_hrs)}h to finish`);
  if (g.release_status === "upcoming") parts.push("not out yet, so wishlist it");
  else if (g.price_cents === 0) parts.push("free right now");
  else if (g.price_cents != null && g.currency) parts.push(`${formatPrice(g.price_cents, g.currency)} right now`);
  const s = parts.join("; ") || "Close match for what you described";
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}
