// One LLM call for all five "why this fits" lines. Only facts we pass in may be used.
import { groqJson } from "./groq";

export type ExplainInput = { id: string; title: string; tags: string[]; summary: string | null; coop: boolean | null; hours: number | null };

export async function explainResults(message: string, games: ExplainInput[]): Promise<Record<string, string>> {
  const lines = games
    .map((g) => `${g.id}|${g.title}|${g.tags.slice(0, 8).join(", ")}|coop:${g.coop ? "yes" : "no"}|~${g.hours ?? "?"}h|${(g.summary ?? "").slice(0, 140)}`)
    .join("\n");
  const { data } = await groqJson<{ reasons?: Record<string, string> }>("explain", [
    {
      role: "system",
      content:
        `For each game, write one spoiler-free line (max 18 words) on why it fits the player's request. ` +
        `Use only the facts given; don't mention price. Input lines: id|title|tags|coop|hours|summary. ` +
        `Respond with JSON {"reasons":{"<id>":"<line>"}}.`,
    },
    { role: "user", content: `Request: ${message}\n${lines}` },
  ], { maxTokens: 500, timeoutMs: 10000 });
  const out: Record<string, string> = {};
  for (const g of games) {
    const r = data.reasons?.[g.id];
    if (typeof r === "string" && r.trim()) out[g.id] = r.trim().slice(0, 200);
  }
  return out;
}
