"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { formatPrice } from "@/lib/format";
import type { PriceDetails, StorePrice } from "@/lib/prices/details";
import type { ShopCode } from "@/lib/prices/provider";
import { REGIONS } from "@/lib/regions";

const PriceHistoryChart = dynamic(() => import("./PriceHistoryChart"), {
  ssr: false,
  loading: () => <div className="h-48 animate-pulse rounded bg-bg/60" />,
});

const HINT_STYLE: Record<string, string> = {
  buy: "border-sale/40 bg-sale/10",
  wait: "border-accent/40 bg-accent/10",
  either: "border-border bg-bg/60",
  tracking: "border-border bg-bg/60 text-muted",
};

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Steam vs Epic price comparison, cheapest first, with all-time lows, a 12-month chart and a wait-or-buy hint. */
export function BuyDialog({
  gameId,
  title,
  open,
  onClose,
  onStoreClick,
}: {
  gameId: string;
  title: string;
  open: boolean;
  onClose: () => void;
  onStoreClick: (shop: ShopCode) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<PriceDetails | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open || data) return;
    setError(false);
    fetch(`/api/games/${gameId}/prices`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, [open, data, gameId]);

  const region = data && REGIONS.find((r) => r.code === data.country)?.label;
  const priced = data?.stores.filter((s) => s.priceCents != null) ?? [];
  const currency = priced[0]?.currency;
  const current = Object.fromEntries(priced.map((s) => [s.shop, s.priceCents!])) as Partial<Record<ShopCode, number>>;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={`buy-${gameId}`}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-text backdrop:bg-black/70"
    >
      <div className="space-y-4 p-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id={`buy-${gameId}`} className="text-base font-semibold leading-tight">Where to buy {title}</h2>
            {region && <p className="text-xs text-muted">Prices for {region}, cheapest first</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded px-2 text-lg leading-none text-muted hover:text-text">
            ×
          </button>
        </header>

        {error && <p className="text-sm text-red-400">Couldn&apos;t load prices. Please try again in a moment.</p>}
        {!data && !error && <p className="animate-pulse text-sm text-muted">Checking Steam and Epic prices…</p>}

        {data && (
          <>
            {data.stores.length === 0 ? (
              <p className="text-sm text-muted">No Steam or Epic store page found for this game.</p>
            ) : (
              <ul className="space-y-2">
                {data.stores.map((s, i) => (
                  <StoreRow
                    key={s.shop}
                    s={s}
                    cheapest={i === 0 && priced.length > 1}
                    upcoming={data.releaseStatus === "upcoming"}
                    onClick={() => onStoreClick(s.shop)}
                  />
                ))}
              </ul>
            )}

            {data.hint && (
              <p className={`rounded-lg border px-3 py-2 text-sm ${HINT_STYLE[data.hint.verdict]}`}>{data.hint.text}</p>
            )}

            {data.history.length > 0 && currency && (
              <section className="space-y-1">
                <h3 className="text-sm font-medium">Price history, last 12 months</h3>
                <PriceHistoryChart points={data.history} current={current} currency={currency} />
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer">Show as table</summary>
                  <table className="mt-2 w-full">
                    <thead>
                      <tr className="text-left">
                        <th className="font-medium">Date</th>
                        <th className="font-medium">Store</th>
                        <th className="text-right font-medium">Price</th>
                      </tr>
                    </thead>
                    <tbody className="text-text">
                      {[...data.history].reverse().map((h, i) => (
                        <tr key={i}>
                          <td>{date(h.at)}</td>
                          <td>{h.shop === "steam" ? "Steam" : "Epic"}</td>
                          <td className="text-right">{h.priceCents === 0 ? "Free" : formatPrice(h.priceCents, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </section>
            )}

            <p className="text-xs text-muted">
              Prices from IsThereAnyDeal and the Steam store, checked within the last few hours. Always confirm on the
              store before buying; PlayRadar doesn&apos;t sell games.
            </p>
          </>
        )}
      </div>
    </dialog>
  );
}

function StoreRow({ s, cheapest, upcoming, onClick }: { s: StorePrice; cheapest: boolean; upcoming: boolean; onClick: () => void }) {
  const fmt = (c: number) => (c === 0 ? "Free" : formatPrice(c, s.currency!));
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3">
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {s.name}
          {cheapest && <span className="rounded bg-accent/15 px-1.5 text-xs font-normal text-accent">Cheapest</span>}
          {s.isAllTimeLow && <span className="rounded bg-sale/15 px-1.5 text-xs font-normal text-sale">All-time low</span>}
        </p>
        {s.priceCents != null ? (
          <>
            <p className="text-sm">
              <span className="font-semibold">{fmt(s.priceCents)}</span>
              {s.discountPct > 0 && s.regularCents != null && (
                <>
                  <span className="ml-2 text-xs text-muted line-through">{fmt(s.regularCents)}</span>
                  <span className="ml-1 rounded bg-sale/15 px-1 text-xs text-sale">-{s.discountPct}%</span>
                </>
              )}
            </p>
            <p className="text-xs text-muted">
              {s.saleEndsAt && <>Sale ends {date(s.saleEndsAt)} · </>}
              {s.lowestCents != null && !s.isAllTimeLow && s.lowestCents < s.priceCents && (
                <>Lowest ever {fmt(s.lowestCents)}</>
              )}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted">{upcoming ? "Not released yet" : "Price unavailable in your region"}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <a
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClick}
          className="rounded-full bg-accent px-3 py-1 font-medium text-bg hover:bg-accent-strong"
        >
          {s.shop === "steam" ? "Steam store" : "Epic store"} ↗
        </a>
        {s.appLink && (
          <a href={s.appLink} onClick={onClick} className="rounded-full border border-border px-3 py-1 hover:border-accent hover:text-accent">
            Open in Steam app
          </a>
        )}
      </div>
    </li>
  );
}
