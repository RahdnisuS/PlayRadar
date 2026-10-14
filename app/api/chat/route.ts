import { z } from "zod";
import { handleMessage } from "@/lib/chat/handleMessage";
import { getIdentity } from "@/lib/auth/identity";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/ratelimit";
import { currentRegion } from "@/lib/region";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({
  message: z.string().trim().min(1).max(500),
  sessionId: z.string().regex(/^\d+$/).nullable().optional(),
});

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  if (!(await rateLimit(`chat:ip:${ip}`, 12, 60))) return tooManyRequests();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Message must be 1-500 characters." }, { status: 400 });

  const who = await getIdentity();
  const key = who.kind === "user" ? `chat:user:${who.userId}` : `chat:guest:${who.token}`;
  if (!(await rateLimit(key, 8, 60))) return tooManyRequests();

  const country = await currentRegion(who.kind === "user" ? who.userId : null);
  try {
    const result = await handleMessage({ who, ip, country, message: parsed.data.message, sessionId: parsed.data.sessionId ?? null });
    return Response.json({ ...result, country });
  } catch (e) {
    console.error("chat failed", e);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
