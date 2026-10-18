// Daily: deletes expired rows so the free-tier database stays small, and keeps the privacy page's promise
// (guest chats are deleted after 90 days; signed-in users' chats stay until they delete their account).
// Notifications are never deleted: their dedupe keys stop the same alert being sent twice.
// Usage: npx tsx scripts/jobs/housekeeping.ts [--dry]
import "../env";
import { q, closeDb } from "../db";

const DRY = process.argv.includes("--dry");

const TASKS: { label: string; where: string; table: string }[] = [
  // Cascades to chat_messages, recommendations and recommendation_events.
  { label: "guest chats older than 90 days", table: "chat_sessions", where: "user_id IS NULL AND started_at < now() - interval '90 days'" },
  { label: "expired chat cache", table: "chat_cache", where: "expires_at < now()" },
  { label: "LLM/YouTube usage counters older than 30 days", table: "llm_usage_daily", where: "day < current_date - 30" },
  { label: "email usage counters older than 30 days", table: "email_usage_daily", where: "day < current_date - 30" },
  // The longest rate-limit window is one day.
  { label: "rate-limit windows older than 2 days", table: "rate_limits", where: "window_start < now() - interval '2 days'" },
];

async function main() {
  for (const t of TASKS) {
    const sql = DRY ? `SELECT count(*)::int AS n FROM ${t.table} WHERE ${t.where}` : `WITH d AS (DELETE FROM ${t.table} WHERE ${t.where} RETURNING 1) SELECT count(*)::int AS n FROM d`;
    const [{ n }] = await q<{ n: number }>(sql);
    console.log(`${DRY ? "would delete" : "deleted"} ${n} ${t.label}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeDb);
