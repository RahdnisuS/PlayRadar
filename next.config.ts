import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Covers come straight from IGDB's CDN; skip Vercel image optimization (limited on the free plan).
  images: { unoptimized: true },
  serverExternalPackages: ["pg"],
};

export default nextConfig;
