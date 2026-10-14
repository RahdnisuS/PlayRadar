// Daily LLM budgets, tracked in llm_usage_daily. Each Groq model has its own free quota (~1000 req/day),
// so global caps are per model role and kept safely below it. Per-identity caps count chat turns.
import { q } from "../db";
import type { ModelRole } from "./groq";

export const GLOBAL_CAPS: Record<ModelRole, number> = { filters: 900, explain: 900, heavy: 600 };
export const GUEST_DAILY_TURNS = 10;
export const USER_DAILY_TURNS = 30;
export const IP_DAILY_TURNS = 40; // stops guests from resetting their cap by clearing cookies

export type Identity = { kind: "user"; userId: string } | { kind: "guest"; token: string };

/** Reserves one call on a model's global budget, plus one chat turn for the identity and IP if given. */
export async function tryConsume(role: ModelRole, who?: Identity, ip?: string): Promise<boolean> {
  const scopes = [`global:${role}`];
  const caps = [GLOBAL_CAPS[role]];
  if (who) {
    scopes.push(who.kind === "user" ? `user:${who.userId}` : `guest:${who.token}`);
    caps.push(who.kind === "user" ? USER_DAILY_TURNS : GUEST_DAILY_TURNS);
    if (who.kind === "guest" && ip) {
      scopes.push(`ip:${ip}`);
      caps.push(IP_DAILY_TURNS);
    }
  }
  const [row] = await q<{ ok: boolean }>(`SELECT try_consume_llm($1::text[], $2::int[], 1) AS ok`, [scopes, caps]);
  return row.ok;
}
