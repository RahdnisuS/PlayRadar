import { getGameDetails } from "@/lib/catalog/details";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  if (!(await rateLimit(`game:ip:${clientIp(req.headers)}`, 60, 60))) return tooManyRequests();
  const game = await getGameDetails(id);
  if (!game) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(game, { headers: { "Cache-Control": "public, max-age=3600" } });
}
