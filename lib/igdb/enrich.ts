// Extra signal from IGDB beyond genres/themes:
//  * keywords -> sub-genre tags players actually search for ("soulslike", "metroidvania"...), plus a few moods and
//    perspectives. Only this curated list is used; raw IGDB keywords are noisy ("steam achievements", "duck").
//  * release_dates -> the PC early-access start, when it is well before the full release (Fortnite: 2017 vs 2020).

export type TagRef = { name: string; kind: "genre" | "theme" | "mood" | "mechanic" };

const KEYWORD_TAGS: [RegExp, TagRef][] = [
  [/^souls ?-?(like|borne)$/, { name: "Soulslike", kind: "genre" }],
  [/^metroidvania$/, { name: "Metroidvania", kind: "genre" }],
  [/^rogue ?-?(like|lite)( elements)?$/, { name: "Roguelike", kind: "genre" }],
  [/^(arpg|action rpg|action role-?playing( game)?)$/, { name: "Action RPG", kind: "genre" }],
  [/^jrpg$/, { name: "JRPG", kind: "genre" }],
  [/^crpg$/, { name: "CRPG", kind: "genre" }],
  [/^dungeon crawler$/, { name: "Dungeon crawler", kind: "genre" }],
  [/^deck ?-?build(ing|er)$/, { name: "Deckbuilder", kind: "genre" }],
  [/^city ?-?build(er|ing)$/, { name: "City builder", kind: "genre" }],
  [/^colony (sim|simulation|management)$/, { name: "Colony sim", kind: "genre" }],
  [/^bullet hell$/, { name: "Bullet hell", kind: "genre" }],
  [/^twin ?-?stick shooter$/, { name: "Twin-stick shooter", kind: "genre" }],
  [/^immersive sim$/, { name: "Immersive sim", kind: "genre" }],
  [/^looter shooter$/, { name: "Looter shooter", kind: "genre" }],
  [/^extraction shooter$/, { name: "Extraction shooter", kind: "genre" }],
  [/^hero shooter$/, { name: "Hero shooter", kind: "genre" }],
  [/^(farming|farming sim(ulator)?)$/, { name: "Farming", kind: "genre" }],
  [/^(pixel art|pixel graphics)$/, { name: "Pixel art", kind: "genre" }],
  [/^(isometric|top-?down|top-?down view|bird'?s eye view)$/, { name: "Bird view / Isometric", kind: "mechanic" }],
  [/^open world$/, { name: "Open world", kind: "theme" }],
  [/^(difficult|challenging gameplay|hardcore|punishing)$/, { name: "challenging", kind: "mood" }],
  [/^dark fantasy$/, { name: "dark", kind: "mood" }],
  [/^story rich$/, { name: "story-rich", kind: "mood" }],
  [/^(relaxing|cozy|wholesome)$/, { name: "relaxing", kind: "mood" }],
  [/^atmospheric$/, { name: "atmospheric", kind: "mood" }],
];

export function tagsFromKeywords(keywords: string[]): TagRef[] {
  const out = new Map<string, TagRef>();
  for (const k of keywords) {
    const kw = k.trim().toLowerCase();
    for (const [re, tag] of KEYWORD_TAGS) if (re.test(kw)) out.set(tag.name, tag);
  }
  return [...out.values()];
}

/** Keywords worth showing to the mood tagger: the mapped ones plus short descriptive words, no awards/platform noise. */
export function usefulKeywords(keywords: string[], max = 12): string[] {
  const noise = /steam|achievement|controller|xbox|playstation|award|nominee|winner|pax |kickstarter|crowdfund|netflix|prime gaming|cloud|trading card|digital distribution|previously on/i;
  return keywords.filter((k) => k.length <= 24 && !noise.test(k)).slice(0, max);
}

const PC = 6;
const MIN_GAP_DAYS = 60;

/** Earliest PC early-access date, if it is clearly before the full release date. Returns YYYY-MM-DD. */
export function earlyAccessDate(
  releaseDates: { date?: number; platform?: number; status?: { name?: string } | number }[] | undefined,
  fullRelease: number | undefined,
): string | null {
  const ea = (releaseDates ?? [])
    .filter((d) => d.platform === PC && d.date && typeof d.status === "object" && /early access/i.test(d.status?.name ?? ""))
    .map((d) => d.date!)
    .sort((a, b) => a - b)[0];
  // Future dates are usually placeholders ("Dec 31") for upcoming games.
  if (!ea || ea * 1000 > Date.now()) return null;
  if (fullRelease && fullRelease - ea < MIN_GAP_DAYS * 86400) return null;
  return new Date(ea * 1000).toISOString().slice(0, 10);
}

export const ENRICH_FIELDS = ["keywords.name", "release_dates.date", "release_dates.platform", "release_dates.status.name"];
