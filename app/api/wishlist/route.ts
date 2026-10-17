import { currentUserId } from "@/lib/auth/identity";
import { currentRegion } from "@/lib/region";
import { listWishlist, type WishlistItem } from "@/lib/wishlist";

export const runtime = "nodejs";

export type WishlistResponse = { region: string; items: WishlistItem[] };

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "Please sign in." }, { status: 401 });
  const region = await currentRegion(userId);
  const body: WishlistResponse = { region, items: await listWishlist(userId, region) };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
