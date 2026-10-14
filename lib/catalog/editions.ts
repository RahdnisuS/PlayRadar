// Detects "same game, different edition" titles, e.g. "Darksiders" vs "Darksiders: Warmastered Edition".
const EDITION_WORDS = new Set([
  "edition", "enhanced", "definitive", "goty", "game", "of", "the", "year", "remastered", "remaster", "legendary",
  "special", "complete", "anniversary", "ultimate", "deluxe", "directors", "director", "cut", "redux", "hd", "classic",
  "gold", "premium", "standard", "collection", "final", "royal", "golden", "reloaded", "extended", "version",
  "warmastered", "deathinitive", "full", "clip",
]);

export const normTitle = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[™®©]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** True when `candidate` is `base` plus only edition words ("GTA V" -> "GTA V Enhanced"). */
export function isEditionOf(candidate: string, base: string): boolean {
  const b = normTitle(base);
  const c = normTitle(candidate);
  if (!c.startsWith(b + " ")) return false;
  const extra = c.slice(b.length).trim().split(" ").filter(Boolean);
  return extra.length > 0 && extra.every((w) => EDITION_WORDS.has(w));
}
