// Landing page of the magic link: verifies the one-time token, signs the user in, and moves the guest's chat
// sessions to the account so feedback buttons on earlier results keep working.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isRegion, REGION_COOKIE } from "@/lib/regions";
import { guestToken, supabaseServer } from "@/lib/auth/identity";
import { q } from "@/lib/db";
import { safeNext } from "@/lib/auth/redirect";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const next = safeNext(url.searchParams.get("next"));
  if (!tokenHash) return NextResponse.redirect(new URL("/?signin=invalid", url.origin));

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (error || !data.user) {
    console.error("magic link verify failed", error?.message);
    return NextResponse.redirect(new URL("/?signin=expired", url.origin));
  }

  const userId = data.user.id;
  // A region picked as a guest carries over to the account; on a new device the account's region fills the cookie.
  const store = await cookies();
  const cookieRegion = store.get(REGION_COOKIE)?.value;
  const [u] = await q<{ country_code: string }>(
    `UPDATE users SET email_verified = true, country_code = COALESCE($2, country_code) WHERE id = $1 RETURNING country_code`,
    [userId, isRegion(cookieRegion) ? cookieRegion : null],
  );
  const guest = await guestToken();
  if (guest) {
    await q(`UPDATE chat_sessions SET user_id = $1 WHERE guest_token = $2 AND user_id IS NULL`, [userId, guest]);
  }
  const res = NextResponse.redirect(new URL(next, url.origin));
  if (!isRegion(cookieRegion) && u && isRegion(u.country_code)) {
    res.cookies.set(REGION_COOKIE, u.country_code, {
      path: "/",
      maxAge: 365 * 86400,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}
