// Cheap, deterministic video rules. Most videos are accepted or rejected here; only the borderline band
// goes to the LLM. Target: a spoiler-free 8-15 minute gameplay overview from an official or reputable channel.
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
const HARD_REJECT = /\b(walkthrough|playthrough|let'?s play|longplay|full game|no commentary|ending|endings|boss|bosses|final (boss|chapter|mission)|spoilers?|part\s*\d+|episode\s*\d+|ep\.?\s*\d+|chapter\s*\d+|mission\s*\d+|act\s*\d+|100%|speedrun|all achievements|lore|story explained|cutscenes?|movie|reaction|mod(s|ded)?\b|tier list|vs\.?\b|android|ios|iphone|mobile|apk|switch 2? (?:port|version))/i;
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
  const v = ` ${normTitle(videoTitle)} `;
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

export function judgeOverview(c: Candidate, game: { title: string; developer: string | null; publisher: string | null }): Verdict {
  if (!c.embeddable) return { score: 0, spoilerRisk: 0, reject: "not embeddable" };
  if (HARD_REJECT.test(c.title)) return { score: 0, spoilerRisk: 1, reject: "spoiler/long-form title" };
  if (!mentionsGame(c.title, game.title)) return { score: 0, spoilerRisk: 0, reject: "different game" };
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

/** Picks the best official trailer from IGDB's video list for upcoming games. */
export function pickTrailer(videos: { id: string; name: string }[]): { id: string; kind: "trailer" | "gameplay_trailer" } | null {
  const rank = (n: string) =>
    /gameplay/i.test(n) ? 0 : /official.*trailer|reveal|announce/i.test(n) ? 1 : /trailer/i.test(n) ? 2 : /teaser/i.test(n) ? 3 : 9;
  const ok = videos.filter((v) => rank(v.name) < 9 && !HARD_REJECT.test(v.name));
  ok.sort((a, b) => rank(a.name) - rank(b.name));
  return ok[0] ? { id: ok[0].id, kind: /gameplay/i.test(ok[0].name) ? "gameplay_trailer" : "trailer" } : null;
}
