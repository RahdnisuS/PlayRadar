// Owner-only pages (e.g. /admin/videos): the signed-in user's email must be listed in ADMIN_EMAILS (comma-separated).
import { q } from "../db";
import { currentUserId } from "./identity";

export async function isAdmin(): Promise<boolean> {
  const allowed = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return false;
  const userId = await currentUserId();
  if (!userId) return false;
  const [u] = await q<{ email: string | null }>(`SELECT email FROM users WHERE id = $1 AND email_verified`, [userId]);
  return !!u?.email && allowed.includes(u.email.toLowerCase());
}
