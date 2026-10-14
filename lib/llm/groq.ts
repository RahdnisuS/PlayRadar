// Groq chat client (OpenAI-compatible). Free tier is per model: ~1000 req/day, 8K tokens/min, ~200K tokens/day.
// Each job uses its own model so the quotas add up.

export const MODELS = {
  filters: "openai/gpt-oss-20b",   // chat -> structured filters
  explain: "qwen/qwen3.8-27b",     // "why this fits" lines
  heavy: "openai/gpt-oss-120b",    // seed-time mood tags, borderline video checks
} as const;
export type ModelRole = keyof typeof MODELS;

export class LlmUnavailableError extends Error {}

type Msg = { role: "system" | "user" | "assistant"; content: string };

export async function groqJson<T>(
  role: ModelRole,
  messages: Msg[],
  opts: { maxTokens?: number; timeoutMs?: number; retries?: number } = {},
): Promise<{ data: T; tokens: number }> {
  const model = MODELS[role];
  const body: Record<string, unknown> = {
    model,
    messages,
    response_format: { type: "json_object" },
    max_completion_tokens: opts.maxTokens ?? 800,
    temperature: 0.2,
  };
  if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
  if (model.startsWith("qwen/")) body.reasoning_effort = "none";

  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      });
    } catch (e) {
      throw new LlmUnavailableError(`Groq network error: ${(e as Error).message}`);
    }
    if (r.status === 429 && attempt < (opts.retries ?? 0)) {
      const wait = Math.min(Number(r.headers.get("retry-after") ?? 10), 120) * 1000;
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    if (!r.ok) throw new LlmUnavailableError(`Groq ${model} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const content: string = j.choices?.[0]?.message?.content ?? "";
    try {
      return { data: JSON.parse(content) as T, tokens: j.usage?.total_tokens ?? 0 };
    } catch {
      throw new LlmUnavailableError(`Groq ${model} returned non-JSON`);
    }
  }
}
