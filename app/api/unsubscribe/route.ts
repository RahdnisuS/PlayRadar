// Unsubscribe from all PlayRadar emails by token. Mail clients POST here directly (RFC 8058 one-click, from the
// List-Unsubscribe header); the /unsubscribe page posts here from its button. GET does nothing, so link scanners
// that open every URL in an email can't unsubscribe anyone.
import { q } from "@/lib/db";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await rateLimit(`unsub:ip:${clientIp(req.headers)}`, 20, 3600))) return tooManyRequests();
  const url = new URL(req.url);
  const form = await req.formData().catch(() => null);
  const token = url.searchParams.get("token") ?? (form?.get("token") as string | null);
  const fromPage = form?.get("from") === "page";

  const rows = token
    ? await q(
        `UPDATE users SET email_digest = 'off', free_game_alerts = false WHERE unsubscribe_token = $1 RETURNING 1`,
        [token.slice(0, 100)],
      )
    : [];
  if (fromPage) {
    const to = new URL("/unsubscribe", url.origin);
    to.searchParams.set(rows.length ? "done" : "invalid", "1");
    return Response.redirect(to, 303);
  }
  return rows.length ? new Response("Unsubscribed", { status: 200 }) : new Response("Unknown link", { status: 404 });
}
