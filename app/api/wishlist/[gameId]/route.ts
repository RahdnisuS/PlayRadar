// One wishlist item. PUT adds or updates it; the target price arrives in major units of the user's region currency.
import { after } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/lib/auth/identity";
import { ensureFreshPrices } from "@/lib/prices/service";
import { currentRegion } from "@/lib/region";
import { rateLimit, tooManyRequests } from "@/lib/ratelimit";
import { CURRENCY_BY_COUNTRY, toCents } from "@/lib/search/filters";
import { getWishlistItem, MAX_WISHLIST_ITEMS, removeWishlistItem, saveWishlistItem, type WishlistSettings } from "@/lib/wishlist";

export const runtime = "nodejs";
export const maxDuration = 30;

export type WishlistItemResponse = {
  signedIn: boolean;
  item: WishlistSettings | null;
  currency: string; // region currency a new target price would be stored in
  symbol: string;
};

const NO_STORE = { "Cache-Control": "private, no-store" };

const Body = z.object({
  targetPrice: z.number().positive().max(1_000_000).nullable(),
  alertOnAnySale: z.boolean(),
  alertOnAllTimeLow: z.boolean(),
  alertOnRelease: z.boolean(),
  source: z.enum(["site", "chat"]).default("site"),
});

async function parseId(params: Promise<{ gameId: string }>) {
  const { gameId } = await params;
  return /^\d+$/.test(gameId) ? gameId : null;
}

const unauthorized = () => Response.json({ error: "Please sign in to use your wishlist." }, { status: 401 });

export async function GET(_req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const gameId = await parseId(params);
  if (!gameId) return Response.json({ error: "bad id" }, { status: 400 });
  const userId = await currentUserId();
  const cur = CURRENCY_BY_COUNTRY[await currentRegion(userId)];
  const body: WishlistItemResponse = {
    signedIn: !!userId,
    item: userId ? await getWishlistItem(userId, gameId) : null,
    currency: cur.code,
    symbol: cur.symbol,
  };
  return Response.json(body, { headers: NO_STORE });
}

export async function PUT(req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const gameId = await parseId(params);
  if (!gameId) return Response.json({ error: "bad id" }, { status: 400 });
  const userId = await currentUserId();
  if (!userId) return unauthorized();
  if (!(await rateLimit(`wishlist:user:${userId}`, 60, 3600))) return tooManyRequests();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please check the target price." }, { status: 400 });
  const b = parsed.data;
  const country = await currentRegion(userId);

  const result = await saveWishlistItem(
    userId,
    gameId,
    {
      targetCents: b.targetPrice == null ? null : toCents(b.targetPrice),
      targetCurrency: b.targetPrice == null ? null : CURRENCY_BY_COUNTRY[country].code,
      alertOnAnySale: b.alertOnAnySale,
      alertOnAllTimeLow: b.alertOnAllTimeLow,
      alertOnRelease: b.alertOnRelease,
    },
    b.source,
  );
  if (result === "no_game") return Response.json({ error: "not found" }, { status: 404 });
  if (result === "full") {
    return Response.json({ error: `Your wishlist is full (${MAX_WISHLIST_ITEMS} games). Remove one to add another.` }, { status: 409 });
  }

  // Alerts and the wait-or-buy hint need the 12-month history; fetch it after responding.
  after(async () => {
    try {
      await ensureFreshPrices(gameId, country);
    } catch (e) {
      console.error("wishlist price backfill failed", e);
    }
  });
  return Response.json({ item: await getWishlistItem(userId, gameId) }, { headers: NO_STORE });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const gameId = await parseId(params);
  if (!gameId) return Response.json({ error: "bad id" }, { status: 400 });
  const userId = await currentUserId();
  if (!userId) return unauthorized();
  await removeWishlistItem(userId, gameId);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
