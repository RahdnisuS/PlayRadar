"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPrice } from "@/lib/format";
import type { HistoryPoint } from "@/lib/prices/details";
import type { ShopCode } from "@/lib/prices/provider";

// Literal hex, not CSS variables: SVG stroke attributes don't resolve var() reliably. Same values as
// --series-steam / --series-epic in globals.css (validated for colour-blind separation on the dark surface).
export const SERIES: Record<ShopCode, { label: string; color: string }> = {
  steam: { label: "Steam", color: "#3987e5" },
  epic: { label: "Epic", color: "#d95926" },
};

type Row = { t: number } & Partial<Record<ShopCode, number>>;

/** One row per price change, each store's price carried forward, extended to today. */
function toRows(points: HistoryPoint[], current: Partial<Record<ShopCode, number>>): { rows: Row[]; shops: ShopCode[] } {
  const shops = [...new Set(points.map((p) => p.shop))].sort() as ShopCode[];
  const last: Partial<Record<ShopCode, number>> = {};
  const rows: Row[] = [];
  for (const p of points) {
    last[p.shop] = p.priceCents;
    const t = new Date(p.at).getTime();
    const prev = rows[rows.length - 1];
    if (prev && prev.t === t) Object.assign(prev, last);
    else rows.push({ t, ...last });
  }
  for (const s of shops) if (current[s] != null) last[s] = current[s];
  if (rows.length) rows.push({ t: Date.now(), ...last });
  return { rows, shops };
}

const month = (t: number) => new Date(t).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function PriceHistoryChart({
  points,
  current,
  currency,
}: {
  points: HistoryPoint[];
  current: Partial<Record<ShopCode, number>>;
  currency: string;
}) {
  const { rows, shops } = toRows(points, current);
  const fmt = (c: number) => (c === 0 ? "Free" : formatPrice(c, currency));
  const lastIndex = rows.length - 1;

  return (
    <figure className="space-y-2">
      {shops.length > 1 && (
        <figcaption className="flex gap-4 text-xs text-muted">
          {shops.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: SERIES[s].color }} />
              {SERIES[s].label}
            </span>
          ))}
        </figcaption>
      )}
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 48, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#262d3d" strokeOpacity={0.6} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={month}
              tick={{ fill: "#8b93a7", fontSize: 11 }}
              axisLine={{ stroke: "#262d3d" }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={[0, "auto"]}
              tickFormatter={fmt}
              tick={{ fill: "#8b93a7", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              cursor={{ stroke: "#8b93a7", strokeDasharray: "3 3" }}
              labelFormatter={(t) => day(Number(t))}
              formatter={(v, name) => [fmt(Number(v)), SERIES[name as ShopCode]?.label ?? String(name)]}
              contentStyle={{ background: "#1c2230", border: "1px solid #262d3d", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#8b93a7" }}
              itemStyle={{ color: "#e8ebf2" }}
            />
            {shops.map((s) => (
              <Line
                key={s}
                dataKey={s}
                name={s}
                type="stepAfter"
                stroke={SERIES[s].color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "#141821", strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
                label={
                  shops.length > 1
                    ? ({ index, x, y }: { index?: number; x?: number | string; y?: number | string }) =>
                        index === lastIndex ? (
                          <text key={s} x={Number(x) + 6} y={Number(y)} dy={4} fontSize={11} fill="#e8ebf2">
                            {SERIES[s].label}
                          </text>
                        ) : (
                          <g key={`${s}-${index}`} />
                        )
                    : undefined
                }
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
