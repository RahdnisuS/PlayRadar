// Fixed-window rate limiting in Postgres (hit_rate_limit), so no extra service is needed.
import { q } from "./db";

export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const [row] = await q<{ ok: boolean }>(`SELECT hit_rate_limit($1, $2, $3) AS ok`, [key, max, windowSeconds]);
  return row.ok;
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || "unknown";
}

export function tooManyRequests() {
  return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 });
}
