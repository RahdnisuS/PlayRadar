// One chat turn: cache -> (LLM filters | fallback parser) -> match_games -> reasons -> persist.
import { createHash } from "crypto";
import { q } from "../db";
import { extractFilters } from "../llm/extractFilters";
import { explainResults } from "../llm/explain";
import { tryConsume, type Identity } from "../llm/caps";
import { LlmUnavailableError } from "../llm/groq";
import { embedQuery, toPgVector } from "../search/embed";
import { parseFallback } from "../search/fallbackParser";
import { FiltersSchema, sanitize, tagVocabulary, withDefaults, CURRENCY_BY_COUNTRY, type Filters } from "../search/filters";
import { retrieve, type ResultGame } from "../search/retrieve";
import { templateReason } from "../search/templates";
import { formatPrice } from "../format";

const SIMILAR_CACHE_THRESHOLD = 0.95;

export type ChatResult = {
  sessionId: string;
  reply: string;
  usedLlm: boolean;
  cache: "exact" | "similar" | null;
  results: (ResultGame & { recommendationId: string; reason: string })[];
};

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}₹$£€\s]/gu, " ").replace(/\s+/g, " ").trim();

async function getOrCreateSession(who: Identity, sessionId: string | null): Promise<string> {
  if (sessionId) {
    const [row] = await q<{ id: string }>(
      `SELECT id FROM chat_sessions WHERE id = $1 AND (user_id = $2::uuid OR guest_token = $3)`,
      [sessionId, who.kind === "user" ? who.userId : null, who.kind === "guest" ? who.token : null],
    );
    if (row) return row.id;
  }
  const [row] = await q<{ id: string }>(
    `INSERT INTO chat_sessions (user_id, guest_token) VALUES ($1, $2) RETURNING id`,
    [who.kind === "user" ? who.userId : null, who.kind === "guest" ? who.token : null],
  );
  return row.id;
}

async function previousFilters(sessionId: string): Promise<Filters | null> {
  const [row] = await q<{ extracted_filters: unknown }>(
    `SELECT extracted_filters FROM chat_messages WHERE session_id = $1 AND role = 'user' AND extracted_filters IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId],
  );
  const parsed = FiltersSchema.safeParse(row?.extracted_filters);
  return parsed.success ? parsed.data : null;
}

function describe(f: Filters, country: string): string {
  const bits: string[] = [];
  if (f.tags_any.length) bits.push(f.tags_any.slice(0, 3).join(", ").toLowerCase());
  if (f.coop) bits.push("co-op");
  else if (f.multiplayer) bits.push("multiplayer");
  else if (f.single_player) bits.push("solo");
  if (f.max_price_cents === 0) bits.push("free");
  else if (f.max_price_cents != null) bits.push(`under ${formatPrice(f.max_price_cents, CURRENCY_BY_COUNTRY[country].code)}`);
  if (f.max_playtime_hrs) bits.push(`under ${f.max_playtime_hrs}h`);
  if (f.release_status?.includes("upcoming") && f.release_status.length === 1) bits.push("upcoming");
  return bits.join(" · ");
}

export async function handleMessage(opts: {
  who: Identity;
  ip: string;
  country: string;
  message: string;
  sessionId: string | null;
}): Promise<ChatResult> {
  const { who, ip, country, message } = opts;
  const userId = who.kind === "user" ? who.userId : null;
  const sessionId = await getOrCreateSession(who, opts.sessionId);
  const prev = await previousFilters(sessionId);
  const vocab = await tagVocabulary();
  const vocabNames = vocab.map((t) => t.name);

  // 1. Cache: exact (same text + previous filters + region), then similar wording on first turns.
  const queryHash = createHash("sha256").update(JSON.stringify([normalize(message), prev, country])).digest("hex");
  let cache: ChatResult["cache"] = null;
  let filters: Filters | null = null;
  let cachedReasons: Record<string, string> = {};
  const [exact] = await q<{ filters: unknown; reasons: Record<string, string> | null }>(
    `SELECT filters, reasons FROM chat_cache WHERE query_hash = $1 AND expires_at > now()`,
    [queryHash],
  );
  if (exact) {
    filters = FiltersSchema.parse(exact.filters);
    cachedReasons = exact.reasons ?? {};
    cache = "exact";
  }

  const messageEmb = await embedQuery(message);
  if (!filters && !prev && messageEmb) {
    const [similar] = await q<{ filters: unknown; reasons: Record<string, string> | null }>(
      `SELECT filters, reasons FROM chat_cache
       WHERE country_code = $2 AND expires_at > now() AND query_embedding IS NOT NULL
         AND 1 - (query_embedding <=> $1::vector) >= $3
       ORDER BY query_embedding <=> $1::vector LIMIT 1`,
      [toPgVector(messageEmb), country, SIMILAR_CACHE_THRESHOLD],
    );
    if (similar) {
      filters = FiltersSchema.parse(similar.filters);
      cachedReasons = similar.reasons ?? {};
      cache = "similar";
    }
  }

  // 2. Filters: LLM within caps, otherwise the keyword parser.
  let usedLlm = false;
  if (!filters) {
    if (await tryConsume("filters", who, ip)) {
      try {
        filters = sanitize(await extractFilters(message, prev, country, vocab), vocabNames);
        usedLlm = true;
      } catch (e) {
        // Groq down, rate-limited or returned bad JSON: answer with the keyword parser instead.
        console.warn("filter extraction failed, using fallback:", e instanceof LlmUnavailableError ? e.message : e);
      }
    }
    filters ??= sanitize(parseFallback(message, country, prev ?? undefined), vocabNames);
  }
  const effective = withDefaults(filters);

  // 3. Retrieval. Embed the restated request when it differs from the raw message (follow-up turns).
  const queryText = effective.query_text || message;
  const emb = queryText === message ? messageEmb : await embedQuery(queryText);
  const { games, relaxed } = await retrieve(effective, emb, country, userId);

  // 4. Reasons: cached ones first, then one LLM call for the rest (only when this turn could use the LLM).
  const reasons: Record<string, string> = {};
  for (const g of games) if (cachedReasons[g.id]) reasons[g.id] = cachedReasons[g.id];
  const missing = games.filter((g) => !reasons[g.id]);
  if (missing.length && usedLlm && (await tryConsume("explain"))) {
    try {
      Object.assign(reasons, await explainResults(message, missing.map((g) => ({
        id: g.id, title: g.title, tags: [...g.matched_tags, ...g.tags, ...g.moods], summary: g.summary,
        coop: g.is_coop, hours: g.avg_playtime_hrs,
      }))));
    } catch {
      // fall through to templates
    }
  }
  for (const g of games) {
    reasons[g.id] ??= templateReason({
      title: g.title, matched_tags: g.matched_tags, moods: g.moods, is_coop: g.is_coop,
      avg_playtime_hrs: g.avg_playtime_hrs, price_cents: g.price_cents, currency: g.currency, release_status: g.release_status,
    });
  }

  // 5. Cache LLM work (filters + reasons) for a day.
  if (usedLlm) {
    await q(
      `INSERT INTO chat_cache (query_hash, country_code, filters, game_ids, reasons, query_embedding, normalized_text)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       ON CONFLICT (query_hash) DO UPDATE SET filters = EXCLUDED.filters, game_ids = EXCLUDED.game_ids,
         reasons = EXCLUDED.reasons, created_at = now(), expires_at = now() + interval '1 day'`,
      [queryHash, country, JSON.stringify(filters), games.map((g) => g.id), JSON.stringify(reasons),
       prev ? null : toPgVector(messageEmb), normalize(message)],
    );
  }

  // 6. Reply text and persistence.
  const summary = describe(effective, country);
  const reply = games.length
    ? `Here ${games.length === 1 ? "is a pick" : `are ${games.length} picks`}${summary ? ` for ${summary}` : ""}.` +
      (relaxed ? ` Not enough exact matches, so I ${relaxed}.` : "")
    : `I couldn't find anything in our catalog for that${summary ? ` (${summary})` : ""}. Try a bigger budget or fewer requirements.`;

  await q(
    `INSERT INTO chat_messages (session_id, role, content, extracted_filters, used_llm) VALUES
       ($1, 'user', $2, $3, $4), ($1, 'assistant', $5, NULL, $4)`,
    [sessionId, message, JSON.stringify(filters), usedLlm, reply],
  );
  const recIds = await q<{ id: string; game_id: string }>(
    `INSERT INTO recommendations (session_id, game_id, rank, match_score, reason)
     SELECT $1, x.game_id, x.rank, x.score, x.reason
     FROM unnest($2::bigint[], $3::smallint[], $4::real[], $5::text[]) AS x(game_id, rank, score, reason)
     RETURNING id, game_id`,
    [sessionId, games.map((g) => g.id), games.map((_, i) => i + 1), games.map((g) => g.score), games.map((g) => reasons[g.id])],
  );
  await q(`UPDATE chat_sessions SET state = $2 WHERE id = $1`, [sessionId, games.length ? "showing_results" : "discovering"]);
  const recByGame = new Map(recIds.map((r) => [String(r.game_id), String(r.id)]));

  return {
    sessionId: String(sessionId),
    reply,
    usedLlm,
    cache,
    results: games.map((g) => ({ ...g, recommendationId: recByGame.get(g.id)!, reason: reasons[g.id] })),
  };
}
