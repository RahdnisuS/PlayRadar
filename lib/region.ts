import { cookies } from "next/headers";
import { q } from "./db";

export const REGIONS = [
  { code: "IN", label: "India (₹)" },
  { code: "US", label: "United States ($)" },
  { code: "GB", label: "United Kingdom (£)" },
  { code: "DE", label: "Europe (€)" },
] as const;
export type RegionCode = (typeof REGIONS)[number]["code"];
export const REGION_COOKIE = "pr_region";

export const isRegion = (c: unknown): c is RegionCode => REGIONS.some((r) => r.code === c);

/** Signed-in users: their saved country. Guests: the region cookie. Default India. */
export async function currentRegion(userId: string | null): Promise<RegionCode> {
  if (userId) {
    const [row] = await q<{ country_code: string }>(`SELECT country_code FROM users WHERE id = $1`, [userId]);
    if (row && isRegion(row.country_code)) return row.country_code;
  }
  const c = (await cookies()).get(REGION_COOKIE)?.value;
  return isRegion(c) ? c : "IN";
}
