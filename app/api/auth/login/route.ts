// Sends a magic-link email. Server-side so we can rate-limit: auth emails share Brevo's 300/day with alerts.
// The email template links to {{ .RedirectTo }}&token_hash=…, so RedirectTo always carries a query string.
import { z } from "zod";
import { supabaseServer } from "@/lib/auth/identity";
import { safeNext } from "@/lib/auth/redirect";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";

const AUTH_EMAILS_PER_DAY = 80; // leaves ~200/day of the Brevo quota for alerts

const Body = z.object({
  email: z.email().max(254),
  next: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  const ip = clientIp(req.headers);

  if (
    !(await rateLimit(`auth:ip:${ip}`, 5, 3600)) ||
    !(await rateLimit(`auth:email:${email}`, 3, 3600)) ||
    !(await rateLimit("auth:global", AUTH_EMAILS_PER_DAY, 86400))
  ) {
    return tooManyRequests();
  }

  const origin = new URL(req.url).origin;
  const redirectTo = `${origin}/auth/confirm?next=${encodeURIComponent(safeNext(parsed.data.next))}`;
  const { error } = await (await supabaseServer()).auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  });
  if (error) {
    console.error("magic link failed", error.status, error.message);
    const status = error.status === 429 ? 429 : 502;
    return Response.json(
      { error: status === 429 ? "Too many sign-in emails. Please wait a minute and try again." : "Couldn't send the email. Please try again." },
      { status },
    );
  }
  return Response.json({ ok: true });
}
