// Cheap, deterministic video rules. Most videos are accepted or rejected here; only the borderline band
// goes to the LLM. Target: a spoiler-free 8-15 minute gameplay overview from an official or reputable channel.
import { ALIASES } from "../catalog/aliases";
import { normTitle } from "../catalog/editions";

export type Candidate = {
  youtubeId: string;
  title: string;
  channelTitle: string;
  description: string;
  durationSec: number;
  embeddable: boolean;
};

export type Verdict = { score: number; spoilerRisk: number; reject: string | null };

// Titles that signal full playthroughs, spoilers or episodic content.
const HARD_REJECT = /\b(walkthrough|playthrough|let'?s play|longplay|full game|no commentary|ending|endings|boss|bosses|final (boss|chapter|mission)|spoilers?|part\s*#?\d+|episode\s*#?\d+|ep\.?\s*#?\d+|chapter\s*#?\d+|mission\s*#?\d+|act\s*#?\d+|100%|speedrun|all achievements|lore|story explained|story summary|complete story|full story|cutscenes?|movie|reaction|mod(s|ded)?\b|tier list|vs\.?\b|android|ios|iphone|mobile|apk|switch 2? (?:port|version))/i;
// Personal-challenge, competitive and tips videos: popular, but they don't show a newcomer what the game is.
const OFF_FORMAT = /\b((i|we) (studied|played|spent|tried|beat|survived|became|got)\b|\d+\s*(hours|days|years)\b|pro (gameplay|players?|tips|settings)\b|tips\b|tricks\b|how to (win|get|improve|be|play better)\b|ranked\b|tournaments?\b|cup\b|fncs\b|esports?\b|competitive\b|highlights\b|montage\b|funny moments\b|challenges?\b|clutch\b|\d+\s*(kills|wins)\b|world record)/i;
// Added after the 50-video hand-labelled eval (2026-10-18): performance tests, farming/build guides, multi-game
// roundups. Console footage itself is fine (labelled good), so platforms are not rejected.
const NOT_OVERVIEW = /\b(framerate|frame rate|fps test|performance (test|review)|benchmark|farm(ing)? (guide|spots?|method|route)|best (solo |early |easy )?(farm|build|weapons?|class|loadout)s?|money (making|method)|xp farm|gold farm|exploit|glitch|moveset|combo guide|new releases|upcoming games|top \d+|\d+ (best|new) games)\b/i;
// Accented Latin letters or a non-Latin script usually mean a non-English video (unless the game's own title has them).
const ACCENTED = /[À-ÖØ-öø-ÿ]|(?!\p{Script=Latin})\p{L}/u;
const SOFT_RISK = /\b(secret|hidden|twist|true|last|death|dies|killer|reveal(ed)?|post[- ]game|dlc)\b/i;
const GOOD_WORDS = /\b(gameplay|overview|features?|first look|first impressions?|impressions|before you buy|review|preview|showcase|deep dive|beginner'?s guide|is it worth|should you buy|explained in)\b/i;

const REPUTABLE = [
  "ign", "gamespot", "gameranx", "skill up", "acg", "worth a buy", "before you buy", "eurogamer", "pc gamer",
  "rock paper shotgun", "polygon", "gamesradar", "digital foundry", "noclip", "gametrailers", "game informer",
  "giant bomb", "the escapist", "kotaku", "mortismal gaming", "splattercat gaming", "wanderbots", "retromation",
  "olexa", "aliens rock", "nookrium", "orbital potato", "many a true nerd", "gameslice", "cohh carnage",
  "outside xbox", "outside xtra", "easy allies", "metacritic", "playstation", "xbox", "steam", "epic games",
];

const minutes = (s: number) => s / 60;

function channelScore(channel: string, game: { title: string; developer: string | null; publisher: string | null }) {
  const c = normTitle(channel);
  const official = [game.developer, game.publisher, game.title]
    .filter((x): x is string => !!x)
    .map((x) => normTitle(x).replace(/\b(inc|ltd|llc|studios?|games|entertainment|interactive|co)\b/g, "").trim())
    .some((name) => name.length >= 3 && (c.includes(name) || name.includes(c)));
  if (official) return 3;
  return REPUTABLE.some((r) => c === r || c.startsWith(r + " ") || c.endsWith(" " + r)) ? 2 : 0;
}

/**
 * Does the video title name this game? The full title, or its main part before a colon/dash, must appear as a
 * contiguous phrase ("Crime Scene Cleaner" must not match "Crime Scene Evidence Cleaner").
 */
export function mentionsGame(videoTitle: string, gameTitle: string): boolean {
  const plain = normTitle(videoTitle);
  const expanded = plain.split(" ").map((w) => ALIASES[w] ?? w).join(" ");
  // Both forms, so an abbreviation can add a match ("GTA" -> "grand theft auto") but never remove one.
  const v = ` ${plain} | ${expanded} `;
  // A number or roman numeral right after the name means a sequel ("Portal" must not match "Portal 2").
  const contains = (phrase: string) => {
    const re = new RegExp(` ${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (?!(?:\\d+|ii|iii|iv|v|vi|vii|viii|ix|x) )`);
    return re.test(v);
  };
  const full = normTitle(gameTitle);
  if (full && contains(full)) return true;
  const main = normTitle(gameTitle.split(/[:–—]| - /)[0]);
  return main !== full && (main.split(" ").length >= 2 || main.length >= 8) && contains(main);
}

/** The video title with the game's own name cut out, so "Invincible Vs." or "Farming Simulator" don't trip the word rules. */
export function withoutGame(videoTitle: string, gameTitle: string): string {
  const words = normTitle(gameTitle).split(" ").filter(Boolean);
  const plain = videoTitle.normalize("NFKD").replace(/['’]/g, "");
  return words.length ? plain.replace(new RegExp(words.join("[^a-z0-9]+"), "i"), " ") : plain;
}

/** Title rules shared by search results and IGDB trailers (IGDB's own video names can hide a playthrough). */
function titleReject(c: Candidate, gameTitle: string): Verdict | null {
  const t = withoutGame(c.title, gameTitle);
  if (HARD_REJECT.test(t)) return { score: 0, spoilerRisk: 1, reject: "spoiler/long-form title" };
  if (OFF_FORMAT.test(t)) return { score: 0, spoilerRisk: 0, reject: "challenge/competitive/tips video" };
  if (NOT_OVERVIEW.test(t)) return { score: 0, spoilerRisk: 0, reject: "guide/benchmark/roundup" };
  return null;
}

/** "Claudio Overview - Tekken 7": a leading "X Overview" that isn't the game is about one character or map. */
function partOverview(videoTitle: string, gameTitle: string): boolean {
  const parts = videoTitle.split(/\s[-|–—]\s|[([\]]/);
  return parts.length > 1 && /\boverview\s*$/i.test(parts[0]) && !mentionsGame(parts[0], gameTitle);
}

export function judgeOverview(c: Candidate, game: { title: string; developer: string | null; publisher: string | null }): Verdict {
  if (!c.embeddable) return { score: 0, spoilerRisk: 0, reject: "not embeddable" };
  const bad = titleReject(c, game.title);
  if (bad) return bad;
  // Overviews are narrated, so language matters; official trailers (trailerReject) are mostly visual and may be in any language.
  if (ACCENTED.test(c.title) && !ACCENTED.test(game.title)) return { score: 0, spoilerRisk: 0, reject: "not English" };
  if (!mentionsGame(c.title, game.title)) return { score: 0, spoilerRisk: 0, reject: "different game" };
  if (partOverview(c.title, game.title)) return { score: 0, spoilerRisk: 0, reject: "overview of one part" };
  const m = minutes(c.durationSec);
  if (m < 5 || m > 22) return { score: 0, spoilerRisk: 0, reject: "duration" };

  let score = 0;
  score += m >= 8 && m <= 15 ? 3 : 1;
  score += channelScore(c.channelTitle, game);
  if (GOOD_WORDS.test(c.title)) score += 2;
  if (/\btrailer\b/i.test(c.title)) score -= 2; // released games should get gameplay, not a trailer
  const spoilerRisk = SOFT_RISK.test(c.title) ? 0.5 : 0.1;
  if (spoilerRisk > 0.3) score -= 2;
  return { score, spoilerRisk, reject: null };
}

/** Scores at or above ACCEPT are taken by rules; BORDERLINE..ACCEPT-1 are sent to the LLM; below is rejected. */
export const ACCEPT = 6;
export const BORDERLINE = 3;

/** IGDB's video list for a game, best first (gameplay, official trailer, trailer, teaser), by IGDB's video names. */
export function rankTrailers(videos: { id: string; name: string }[]): { id: string; kind: "trailer" | "gameplay_trailer" }[] {
  const rank = (n: string) =>
    /gameplay/i.test(n) ? 0 : /official.*trailer|reveal|announce/i.test(n) ? 1 : /trailer/i.test(n) ? 2 : /teaser/i.test(n) ? 3 : 9;
  return videos
    .filter((v) => rank(v.name) < 9 && !HARD_REJECT.test(v.name))
    .sort((a, b) => rank(a.name) - rank(b.name))
    .map((v) => ({ id: v.id, kind: /gameplay/i.test(v.name) ? "gameplay_trailer" : "trailer" }));
}

export const MAX_TRAILER_SEC = 15 * 60;

/** Checks an IGDB trailer's real YouTube title and length: IGDB has listed playthroughs and tournament matches as "Gameplay". */
export function trailerReject(c: Candidate, gameTitle: string): string | null {
  if (!c.embeddable) return "not embeddable";
  if (c.durationSec > MAX_TRAILER_SEC) return "too long for a trailer";
  return titleReject(c, gameTitle)?.reject ?? null;
}
