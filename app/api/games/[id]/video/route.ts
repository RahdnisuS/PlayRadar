import { ensureVideo } from "@/lib/video/select";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  if (!(await rateLimit(`video:ip:${clientIp(req.headers)}`, 30, 60))) return tooManyRequests();
  try {
    const video = await ensureVideo(id);
    return Response.json({ video }, { headers: { "Cache-Control": video ? "public, max-age=3600" : "no-store" } });
  } catch (e) {
    console.error("video selection failed", e);
    return Response.json({ video: null });
  }
}
