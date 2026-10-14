// Minimal IGDB v4 client (Twitch app credentials). Free tier: 4 req/s, 8 concurrent, 500 rows per request.

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const API = "https://api.igdb.com/v4";

let token: { value: string; expiresAt: number } | null = null;
let lastCall = 0;

async function getToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value;
  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID!,
    client_secret: process.env.TWITCH_CLIENT_SECRET!,
    grant_type: "client_credentials",
  });
  const r = await fetch(`${TOKEN_URL}?${params}`, { method: "POST" });
  if (!r.ok) throw new Error(`Twitch token ${r.status}`);
  const j = await r.json();
  token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in - 300) * 1000 };
  return token.value;
}

/** Runs an Apicalypse query, spaced to stay under 4 requests/second. */
export async function igdb<T>(endpoint: string, body: string): Promise<T[]> {
  const wait = lastCall + 300 - Date.now();
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  lastCall = Date.now();
  const r = await fetch(`${API}/${endpoint}`, {
    method: "POST",
    headers: { "Client-ID": process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${await getToken()}` },
    body,
  });
  if (r.status === 429) {
    await new Promise((res) => setTimeout(res, 1000));
    return igdb(endpoint, body);
  }
  if (!r.ok) throw new Error(`IGDB ${endpoint} ${r.status}: ${await r.text()}`);
  return r.json();
}

// IGDB enum ids (verified against /external_game_sources, /game_types, /game_statuses).
export const SOURCE_STEAM = 1;
export const SOURCE_EPIC = 26;
export const GAME_TYPES_BASE = [0, 8, 9, 10]; // main game, remake, remaster, expanded game
export const STATUS_EARLY_ACCESS = 4;
export const STATUSES_SKIP = [5, 6, 7, 8]; // offline, cancelled, rumored, delisted
export const POP_STEAM_TOTAL_REVIEWS = 8;
export const POP_STEAM_MOST_WISHLISTED_UPCOMING = 10;

export const coverUrl = (imageId: string) => `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;

/** "https://store.epicgames.com/en-US/p/hades" -> "hades" */
export function epicSlugFromUrl(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/epicgames\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?(?:p|product)\/([^/?#]+)/);
  return m ? m[1] : null;
}
