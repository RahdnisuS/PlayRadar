// The structured filters the chat produces (by LLM or by the fallback parser) and match_games consumes.
import { z } from "zod";
import { q } from "../db";

export const FiltersSchema = z.object({
  tags_any: z.array(z.string()).default([]),
  tags_exclude: z.array(z.string()).default([]),
  coop: z.boolean().optional(),
  multiplayer: z.boolean().optional(),
  single_player: z.boolean().optional(),
  max_price_cents: z.number().int().nonnegative().optional(),
  min_playtime_hrs: z.number().nonnegative().optional(),
  max_playtime_hrs: z.number().positive().optional(),
  release_status: z.array(z.enum(["released", "upcoming", "early_access"])).optional(),
  /** Free-text description of what the user wants, embedded for similarity search. */
  query_text: z.string().max(500).default(""),
  /** Set by the server only (session "Not for me" and "Show similar"); stripped from LLM output. */
  exclude_ids: z.array(z.string()).optional(),
});
export type Filters = z.infer<typeof FiltersSchema>;

export const EMPTY_FILTERS: Filters = FiltersSchema.parse({});

/** Unless the user asks for upcoming games, only show things they can buy today. */
export function withDefaults(f: Filters): Filters {
  return f.release_status?.length ? f : { ...f, release_status: ["released", "early_access"] };
}

/** Keep only tag names that exist in our vocabulary (case-insensitive), so SQL filters can't silently match nothing. */
export function sanitize(f: Filters, vocab: string[]): Filters {
  const byLower = new Map(vocab.map((t) => [t.toLowerCase(), t]));
  const fix = (tags: string[]) => [...new Set(tags.map((t) => byLower.get(t.toLowerCase())).filter((t): t is string => !!t))];
  return { ...f, tags_any: fix(f.tags_any), tags_exclude: fix(f.tags_exclude), exclude_ids: undefined };
}

let vocabCache: { at: number; tags: { name: string; kind: string }[] } | null = null;

export async function tagVocabulary(): Promise<{ name: string; kind: string }[]> {
  if (vocabCache && Date.now() - vocabCache.at < 10 * 60 * 1000) return vocabCache.tags;
  const tags = await q<{ name: string; kind: string }>(
    `SELECT t.name, t.kind FROM tags t WHERE EXISTS (SELECT 1 FROM game_tags gt WHERE gt.tag_id = t.id) ORDER BY t.kind, t.name`,
  );
  vocabCache = { at: Date.now(), tags };
  return tags;
}

/** Map a price typed by the user ("800", "₹800", "$15") to minor units in the region's currency. */
export function toCents(amount: number) {
  return Math.round(amount * 100);
}

export const CURRENCY_BY_COUNTRY: Record<string, { code: string; symbol: string; cheap: number }> = {
  IN: { code: "INR", symbol: "₹", cheap: 500 },
  US: { code: "USD", symbol: "$", cheap: 10 },
  GB: { code: "GBP", symbol: "£", cheap: 8 },
  DE: { code: "EUR", symbol: "€", cheap: 10 },
};
