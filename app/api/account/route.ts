// Email preferences for the signed-in user.
import { z } from "zod";
import { currentUserId } from "@/lib/auth/identity";
import { q } from "@/lib/db";

export const runtime = "nodejs";

const Body = z
  .object({
    emailDigest: z.enum(["instant", "daily", "weekly", "off"]).optional(),
    freeGameAlerts: z.boolean().optional(),
  })
  .refine((b) => b.emailDigest !== undefined || b.freeGameAlerts !== undefined);

export async function PATCH(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "Please sign in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad settings" }, { status: 400 });
  const { emailDigest, freeGameAlerts } = parsed.data;
  await q(
    `UPDATE users SET email_digest = COALESCE($2, email_digest), free_game_alerts = COALESCE($3, free_game_alerts)
     WHERE id = $1`,
    [userId, emailDigest ?? null, freeGameAlerts ?? null],
  );
  return Response.json({ ok: true });
}
