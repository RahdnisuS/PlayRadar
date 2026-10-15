"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_REGION, REGION_COOKIE, REGIONS, isRegion, type RegionCode } from "@/lib/regions";

/** Price region picker. Reads the cookie client-side so the layout can stay static. */
export function RegionSelect() {
  const router = useRouter();
  const [region, setRegion] = useState<RegionCode>(DEFAULT_REGION);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const m = document.cookie.match(new RegExp(`(?:^|; )${REGION_COOKIE}=([A-Z]{2})`));
    if (m && isRegion(m[1])) setRegion(m[1]);
  }, []);

  async function change(next: RegionCode) {
    const prev = region;
    setRegion(next);
    setSaving(true);
    try {
      const r = await fetch("/api/region", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country: next }),
      });
      if (!r.ok) throw new Error();
      router.refresh();
    } catch {
      setRegion(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="hidden sm:inline">Prices for</span>
      <select
        value={region}
        disabled={saving}
        onChange={(e) => change(e.target.value as RegionCode)}
        aria-label="Price region"
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text outline-none focus:border-accent disabled:opacity-60"
      >
        {REGIONS.map((r) => (
          <option key={r.code} value={r.code}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );
}
