// Landing page of the magic link: verifies the one-time token, signs the user in, and moves the guest's chat
// sessions to the account so feedback buttons on earlier results keep working.
import { NextResponse } from "next/server";
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
  await q(`UPDATE users SET email_verified = true WHERE id = $1`, [userId]);
  const guest = await guestToken();
  if (guest) {
    await q(`UPDATE chat_sessions SET user_id = $1 WHERE guest_token = $2 AND user_id IS NULL`, [userId, guest]);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
