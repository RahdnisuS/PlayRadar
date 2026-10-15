import { currentUserId } from "@/lib/auth/identity";
import { getPriceDetails } from "@/lib/prices/details";
import { ensureFreshPrices } from "@/lib/prices/service";
import { currentRegion } from "@/lib/region";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  if (!(await rateLimit(`prices:ip:${clientIp(req.headers)}`, 20, 60))) return tooManyRequests();
  const country = await currentRegion(await currentUserId());
  try {
    await ensureFreshPrices(id, country);
  } catch (e) {
    // Price source down: still show whatever we have cached.
    console.error("price refresh failed", e);
  }
  const details = await getPriceDetails(id, country);
  if (!details) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(details, { headers: { "Cache-Control": "private, max-age=300" } });
}
