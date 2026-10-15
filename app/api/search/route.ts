import { currentUserId } from "@/lib/auth/identity";
import { searchGames } from "@/lib/catalog/search";
import { currentRegion } from "@/lib/region";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const query = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  if (query.trim().length < 2) return Response.json({ results: [] });
  if (!(await rateLimit(`search:ip:${clientIp(req.headers)}`, 90, 60))) return tooManyRequests();
  const country = await currentRegion(await currentUserId());
  const results = await searchGames(query, country);
  return Response.json({ results }, { headers: { "Cache-Control": "private, max-age=60" } });
}
