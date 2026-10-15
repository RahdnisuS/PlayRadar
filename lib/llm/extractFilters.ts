// LLM path: chat message (+ previous filters) -> Filters, constrained to our tag vocabulary.
import { CURRENCY_BY_COUNTRY, FiltersSchema, type Filters } from "../search/filters";
import { groqJson } from "./groq";

export async function extractFilters(
  message: string,
  previous: Filters | null,
  country: string,
  vocab: { name: string; kind: string }[],
): Promise<Filters> {
  const cur = CURRENCY_BY_COUNTRY[country] ?? CURRENCY_BY_COUNTRY.IN;
  const byKind = (k: string) => vocab.filter((t) => t.kind === k).map((t) => t.name).join(", ");
  const system =
    `You convert a PC gamer's request into JSON search filters. Never name or invent games.\n` +
    `Allowed tags (use exact spelling):\n` +
    `genres: ${byKind("genre")}\nthemes: ${byKind("theme")}\nmoods: ${byKind("mood")}\nmodes/perspectives: ${byKind("mechanic")}\n` +
    `Map player slang to these tags: top-down/isometric -> Bird view / Isometric; side-scroller -> Side view; ` +
    `souls-like -> Soulslike; roguelite -> Roguelike; ARPG -> Action RPG. Put the most specific tags first.\n` +
    `Output JSON keys (omit unknowns): tags_any (tags the game should have, 1-6), tags_exclude (tags to avoid), ` +
    `coop, multiplayer, single_player (booleans), max_price_cents (integer, ${cur.code} minor units: ${cur.symbol}1 = 100; free = 0), ` +
    `min_playtime_hrs, max_playtime_hrs ("short" ~ max 12), release_status (array of released|upcoming|early_access; only if asked), ` +
    `query_text (one sentence restating what they want, for semantic search).\n` +
    `If previous filters are given and the message refines them, return the full updated filters; if it asks for something different, start fresh.`;
  const user = previous ? `Previous filters: ${JSON.stringify(previous)}\nMessage: ${message}` : `Message: ${message}`;
  const { data } = await groqJson<unknown>("filters", [
    { role: "system", content: system },
    { role: "user", content: user },
  ], { maxTokens: 600, timeoutMs: 10000 });
  const parsed = FiltersSchema.safeParse(data);
  if (!parsed.success) throw new Error("filters JSON did not match schema");
  return parsed.data;
}
