import { cookies } from "next/headers";
import { q } from "./db";
import { DEFAULT_REGION, isRegion, REGION_COOKIE, type RegionCode } from "./regions";

export { REGIONS, REGION_COOKIE, isRegion, type RegionCode } from "./regions";

/** Signed-in users: their saved country. Guests: the region cookie. Default India. */
export async function currentRegion(userId: string | null): Promise<RegionCode> {
  if (userId) {
    const [row] = await q<{ country_code: string }>(`SELECT country_code FROM users WHERE id = $1`, [userId]);
    if (row && isRegion(row.country_code)) return row.country_code;
  }
  const c = (await cookies()).get(REGION_COOKIE)?.value;
  return isRegion(c) ? c : DEFAULT_REGION;
}
