// Logs feedback on a shown recommendation. Only the session that received the recommendation may log events.
import { z } from "zod";
import { q } from "@/lib/db";
import { getIdentity } from "@/lib/auth/identity";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/ratelimit";
import { applyFeedback } from "@/lib/feedback";

export const runtime = "nodejs";

const Body = z.object({
  recommendationId: z.string().regex(/^\d+$/),
  type: z.enum(["video_played", "video_finished", "liked", "disliked", "wishlisted", "store_click", "not_interested"]),
  store: z.enum(["steam", "epic"]).optional(),
});

export async function POST(req: Request) {
  if (!(await rateLimit(`events:ip:${clientIp(req.headers)}`, 60, 60))) return tooManyRequests();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad event" }, { status: 400 });
  const { recommendationId, type, store } = parsed.data;

  const who = await getIdentity();
  const [rec] = await q<{ id: string; game_id: string }>(
    `SELECT r.id, r.game_id FROM recommendations r JOIN chat_sessions s ON s.id = r.session_id
     WHERE r.id = $1 AND (s.user_id = $2::uuid OR s.guest_token = $3)`,
    [recommendationId, who.kind === "user" ? who.userId : null, who.kind === "guest" ? who.token : null],
  );
  if (!rec) return Response.json({ error: "not found" }, { status: 404 });

  await q(
    `INSERT INTO recommendation_events (recommendation_id, event_type, store_id)
     VALUES ($1, $2, (SELECT id FROM stores WHERE code = $3))`,
    [rec.id, type, store ?? null],
  );
  if (who.kind === "user") await applyFeedback(who.userId, rec.game_id, type);
  return Response.json({ ok: true });
}
