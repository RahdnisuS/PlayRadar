import { cookies } from "next/headers";
import { currentUserId } from "@/lib/auth/identity";
import { q } from "@/lib/db";
import { isRegion, REGION_COOKIE } from "@/lib/region";

export const runtime = "nodejs";

/** Saves the price region: a cookie for everyone, plus users.country_code when signed in. */
export async function POST(req: Request) {
  const { country } = await req.json().catch(() => ({}));
  if (!isRegion(country)) return Response.json({ error: "Unknown region" }, { status: 400 });
  (await cookies()).set(REGION_COOKIE, country, {
    path: "/",
    maxAge: 365 * 86400,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  const userId = await currentUserId();
  if (userId) await q(`UPDATE users SET country_code = $2 WHERE id = $1`, [userId, country]);
  return Response.json({ country });
}
