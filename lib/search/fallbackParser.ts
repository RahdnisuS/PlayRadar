// Non-LLM path: keyword/regex rules that turn a chat message into Filters.
// Used when the daily LLM cap is reached or Groq fails; embedding search covers what the rules miss.
import { CURRENCY_BY_COUNTRY, EMPTY_FILTERS, toCents, type Filters } from "./filters";

// Phrase -> tag names (must exist in the tags table; unknown ones are dropped by sanitize()).
const SYNONYMS: [RegExp, string[]][] = [
  [/\brpgs?\b|role[- ]?play/, ["Role-playing (RPG)"]],
  [/\bfps\b|first[- ]person shooter/, ["Shooter", "First person"]],
  [/\bshooters?\b|\bguns?\b/, ["Shooter"]],
  [/\bhorror\b|\bscary\b|\bspooky\b|\bcreepy\b/, ["Horror", "scary"]],
  [/\bcozy\b|\bcosy\b|\bcomfy\b/, ["cozy"]],
  [/\brelax(ing|ed)?\b|\bchill\b|\bcalm\b|\bunwind\b/, ["relaxing", "chill"]],
  [/\bwholesome\b|\bcute\b/, ["wholesome"]],
  [/\bfunny\b|\bcomedy\b|\bhilarious\b|\blaugh/, ["Comedy", "funny"]],
  [/\bdark\b|\bgrim\b|\bbleak\b/, ["dark"]],
  [/\bgritty\b/, ["gritty"]],
  [/\bstory|\bnarrative\b|\bplot\b/, ["story-rich"]],
  [/\bemotional\b|\bsad\b|\bcry\b|\bfeels\b/, ["emotional", "Drama"]],
  [/\batmospher/, ["atmospheric"]],
  [/\bmyster(y|ious)\b|\bdetective\b/, ["Mystery", "mysterious"]],
  [/\bhard\b|\bdifficult\b|\bchalleng|\bsouls/, ["challenging"]],
  [/\bcompetitive\b|\bpvp\b|\branked\b/, ["competitive"]],
  [/\bfast\b|\bfrantic\b|\badrenaline\b/, ["fast-paced", "intense"]],
  [/\bstrateg|\btactic/, ["Strategy", "Tactical", "strategic"]],
  [/\brts\b|real[- ]time strategy/, ["Real Time Strategy (RTS)"]],
  [/\bturn[- ]based\b/, ["Turn-based strategy (TBS)"]],
  [/\b4x\b/, ["4X"]],
  [/\bpuzzl/, ["Puzzle"]],
  [/\bplatform(er|ing)?\b/, ["Platform"]],
  [/\bracing\b|\bcars?\b|\bdriving\b/, ["Racing"]],
  [/\bsports?\b|\bfootball\b|\bsoccer\b|\bbasketball\b/, ["Sport"]],
  [/\bfight(ing)?\b|\bbrawler\b/, ["Fighting"]],
  [/\bhack and slash\b|\bbeat 'em up\b|\bhack-and-slash\b/, ["Hack and slash/Beat 'em up"]],
  [/\bsim(ulator|ulation)?s?\b|\bfarming\b|\bmanagement\b/, ["Simulator"]],
  [/\bindie\b/, ["Indie"]],
  [/\bopen[- ]world\b|\bexplor/, ["Open world", "adventurous"]],
  [/\bsandbox\b|\bbuild(ing)?\b|\bcraft/, ["Sandbox", "creative"]],
  [/\bsurviv/, ["Survival"]],
  [/\bstealth\b|\bsneak/, ["Stealth"]],
  [/\bfantasy\b|\bmagic\b|\bdragons?\b/, ["Fantasy"]],
  [/\bsci[- ]?fi\b|\bscience fiction\b|\bspace\b|\bfuturistic\b|\bcyberpunk\b/, ["Science fiction"]],
  [/\bhistor|\bmedieval\b/, ["Historical"]],
  [/\bwar\b|\bmilitary\b|\bwarfare\b/, ["Warfare"]],
  [/\bvisual novel\b/, ["Visual Novel"]],
  [/\bcard\b|\bdeck[- ]?build|\bboard game\b/, ["Card & Board Game"]],
  [/\bmoba\b/, ["MOBA"]],
  [/\bpoint[- ]and[- ]click\b/, ["Point-and-click"]],
  [/\bepic\b(?! games| store)/, ["epic"]],
  [/\bnostalg|\bretro\b|\bclassic\b/, ["nostalgic"]],
  [/\badventure\b/, ["Adventure"]],
];

const CURRENCY_SYMBOLS = /(?:₹|rs\.?|inr|rupees?|\$|usd|dollars?|£|gbp|pounds?|€|eur|euros?)/;

function parseBudget(text: string, country: string): number | undefined {
  if (/\bfree\b(?![- ]to[- ]play)/.test(text) && !/\bfree time\b/.test(text)) return 0;
  const m = text.match(
    new RegExp(`(?:under|below|less than|max(?:imum)?|up ?to|within|cheaper than|<|budget(?: of| is)?)\\s*${CURRENCY_SYMBOLS.source}?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*${CURRENCY_SYMBOLS.source}?`),
  );
  if (m) return toCents(Number(m[1].replace(/,/g, "")));
  if (/\bcheap\b|\bbudget\b|\binexpensive\b|\bbroke\b/.test(text)) return toCents(CURRENCY_BY_COUNTRY[country]?.cheap ?? 10);
  return undefined;
}

function parsePlaytime(text: string): Pick<Filters, "min_playtime_hrs" | "max_playtime_hrs"> {
  const under = text.match(/(?:under|less than|below|max(?:imum)?|within|<)\s*(\d+)\s*(?:h\b|hrs?\b|hours?)/);
  if (under) return { max_playtime_hrs: Number(under[1]) };
  const over = text.match(/(?:over|more than|at least|>)\s*(\d+)\s*(?:h\b|hrs?\b|hours?)/);
  if (over) return { min_playtime_hrs: Number(over[1]) };
  if (/\bshort\b|\bquick\b|\bone sitting\b|\bweekend\b|\bbite[- ]sized\b/.test(text)) return { max_playtime_hrs: 12 };
  if (/\blong\b|\bendless\b|\bhundreds of hours\b|\bmassive\b|\bhuge\b/.test(text)) return { min_playtime_hrs: 40 };
  return {};
}

/** Splits "no horror", "not too scary", "without guns" style phrases out of the positive request. */
function negativeChunks(text: string): { positive: string; negative: string } {
  const neg: string[] = [];
  const positive = text.replace(/\b(?:no|not|without|nothing|avoid|hate|don'?t (?:like|want))\s+(?:too\s+|any\s+|more\s+)?([a-z0-9' -]{2,25}?)(?=[,.;!?]|\band\b|\bbut\b|$)/g, (_, w) => {
    neg.push(w);
    return " ";
  });
  return { positive, negative: neg.join(" ") };
}

function tagsIn(text: string): string[] {
  return [...new Set(SYNONYMS.filter(([re]) => re.test(text)).flatMap(([, tags]) => tags))];
}

export function parseFallback(message: string, country: string, previous?: Filters): Filters {
  const text = message.toLowerCase();
  const { positive, negative } = negativeChunks(text);
  const reset = !previous || /\b(something else|different|start over|new search|instead)\b/.test(text);
  const base: Filters = reset ? { ...EMPTY_FILTERS } : { ...previous };

  const f: Filters = {
    ...base,
    tags_any: [...new Set([...(reset ? [] : base.tags_any), ...tagsIn(positive)])],
    tags_exclude: [...new Set([...(reset ? [] : base.tags_exclude), ...tagsIn(negative)])],
    query_text: reset ? message : `${base.query_text} ${message}`.trim().slice(-500),
  };
  f.tags_any = f.tags_any.filter((t) => !f.tags_exclude.includes(t));

  if (/\bco-?op\b|\bcooperative\b|\bwith (?:my )?(?:friends?|partner|girlfriend|boyfriend|wife|husband|brother|sister)\b|\btogether\b/.test(text)) f.coop = true;
  if (/\bmultiplayer\b|\bonline\b|\bpvp\b/.test(positive)) f.multiplayer = true;
  if (/\bsolo\b|\bsingle[- ]?player\b|\balone\b|\bby myself\b/.test(text)) {
    f.single_player = true;
    f.coop = undefined;
    f.multiplayer = undefined;
  }
  const budget = parseBudget(text, country);
  if (budget !== undefined) f.max_price_cents = budget;
  Object.assign(f, parsePlaytime(text));
  if (/\bupcoming\b|\bcoming soon\b|\bunreleased\b|\bnot (?:yet )?out\b|\bannounced\b/.test(text)) f.release_status = ["upcoming"];
  else if (/\bearly access\b/.test(text)) f.release_status = ["early_access"];
  return f;
}
