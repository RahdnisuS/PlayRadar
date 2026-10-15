// Supported price regions. Kept free of Next.js imports so offline scripts can use it.
export const REGIONS = [
  { code: "IN", label: "India (₹)" },
  { code: "US", label: "United States ($)" },
  { code: "GB", label: "United Kingdom (£)" },
  { code: "DE", label: "Europe (€)" },
] as const;
export type RegionCode = (typeof REGIONS)[number]["code"];
export const REGION_COOKIE = "pr_region";
export const DEFAULT_REGION: RegionCode = "IN";

export const isRegion = (c: unknown): c is RegionCode => REGIONS.some((r) => r.code === c);
