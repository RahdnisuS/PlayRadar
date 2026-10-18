"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SearchHit } from "@/lib/catalog/search";
import { formatPrice } from "@/lib/format";
import { GameDialog } from "./GameDialog";

/** Header search: suggestions appear as you type; picking one opens the game popup. */
export function GameSearch() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState(""); // the query the current hits belong to
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setSearched("");
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          setHits(d.results ?? []);
          setSearched(term);
          setActive(-1);
        })
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function pick(h: SearchHit) {
    setPicked({ id: String(h.id), title: h.title });
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? hits.length - 1 : a - 1));
    } else if (e.key === "Enter" && hits.length) {
      e.preventDefault();
      pick(hits[Math.max(active, 0)]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && query.trim().length >= 2 && searched !== "";

  return (
    <>
      <div ref={box} className="relative w-full max-w-md">
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          maxLength={80}
          placeholder="Search…"
          role="combobox"
          aria-label="Search games by title"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-sm outline-none placeholder:text-sm placeholder:text-muted focus:border-accent"
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="fixed inset-x-4 top-14 z-30 max-h-[70vh] sm:absolute sm:inset-x-0 sm:top-full sm:mt-1 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-xl shadow-black/40"
          >
            {hits.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted">
                No games match &ldquo;{searched}&rdquo;. Try describing it in the chat instead.
              </li>
            )}
            {hits.map((h, i) => (
              <li
                key={h.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 ${i === active ? "bg-surface-2" : ""}`}
              >
                {h.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={h.cover_url} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-12 w-9 shrink-0 rounded bg-bg" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{h.title}</p>
                  <p className="text-xs text-muted">
                    {h.release_status === "upcoming"
                      ? "Upcoming"
                      : h.release_date
                        ? new Date(h.release_date).getFullYear()
                        : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs">
                  {h.release_status === "upcoming" ? null : h.min_price_cents != null && h.currency ? (
                    h.min_price_cents === 0 ? "Free" : formatPrice(h.min_price_cents, h.currency)
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {picked && <GameDialog gameId={picked.id} title={picked.title} onClose={() => setPicked(null)} />}
    </>
  );
}
