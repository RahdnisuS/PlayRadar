// Supported price regions. Kept free of Next.js imports so offline scripts can use it.
export const REGIONS = [
  { code: "IN", label: "India (₹)", short: "IN ₹" },
  { code: "US", label: "United States ($)", short: "US $" },
  { code: "GB", label: "United Kingdom (£)", short: "UK £" },
  { code: "DE", label: "Europe (€)", short: "EU €" },
] as const;
export type RegionCode = (typeof REGIONS)[number]["code"];
export const REGION_COOKIE = "pr_region";
export const DEFAULT_REGION: RegionCode = "IN";

export const isRegion = (c: unknown): c is RegionCode => REGIONS.some((r) => r.code === c);
