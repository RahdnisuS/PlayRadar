import { currentUserId } from "@/lib/auth/identity";
import { q } from "@/lib/db";

export const runtime = "nodejs";

export type Me = {
  user: { email: string; emailDigest: "instant" | "daily" | "weekly" | "off"; freeGameAlerts: boolean; wishlistCount: number } | null;
};

/** Who is signed in (null for guests). The header calls this so the layout itself can stay static. */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ user: null } satisfies Me, { headers: { "Cache-Control": "private, no-store" } });
  const [u] = await q<{ email: string; email_digest: string; free_game_alerts: boolean; n: number }>(
    `SELECT email, email_digest, free_game_alerts, (SELECT count(*)::int FROM wishlist_items w WHERE w.user_id = u.id) AS n
     FROM users u WHERE id = $1`,
    [userId],
  );
  const body: Me = {
    user: u
      ? { email: u.email, emailDigest: u.email_digest as NonNullable<Me["user"]>["emailDigest"], freeGameAlerts: u.free_game_alerts, wishlistCount: u.n }
      : null,
  };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
