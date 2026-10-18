// Account deletion: everything tied to the user goes in one transaction.
import { tx } from "./db";

/**
 * Deleting auth.users cascades to public.users, and from there to wishlist_items, notifications,
 * user_tag_affinity and user_excluded_games. chat_sessions only SET NULL on user delete, so they
 * (with their messages, recommendations and events) are deleted explicitly, as are the per-user
 * LLM cap counters and the sign-in rate-limit rows keyed by the email address.
 */
export async function deleteAccount(userId: string): Promise<boolean> {
  return tx(async (c) => {
    const { rows } = await c.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);
    await c.query(`DELETE FROM chat_sessions WHERE user_id = $1`, [userId]);
    await c.query(`DELETE FROM llm_usage_daily WHERE scope_key = $1`, [`user:${userId}`]);
    if (rows[0]?.email) await c.query(`DELETE FROM rate_limits WHERE key = $1`, [`auth:email:${rows[0].email.toLowerCase()}`]);
    const res = await c.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
    return (res.rowCount ?? 0) > 0;
  });
}
