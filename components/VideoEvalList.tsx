"use client";

import { useState } from "react";
import { BAD_REASONS, type BadReason, type EvalItem } from "@/lib/video/evalTypes";

const KIND_LABELS: Record<string, string> = {
  gameplay_overview: "Gameplay overview",
  gameplay_trailer: "Gameplay trailer",
  trailer: "Trailer",
};

const minutes = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : null);

/** The labelling list: one card per game, video loads only when clicked, verdict saves immediately. */
export function VideoEvalList({ initial }: { initial: EvalItem[] }) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const done = items.filter((i) => i.label).length;
  const good = items.filter((i) => i.label?.good).length;
  const shown = filter === "todo" ? items.filter((i) => !i.label) : items;

  const update = (gameId: string, label: EvalItem["label"]) =>
    setItems((list) => list.map((i) => (i.gameId === gameId ? { ...i, label } : i)));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Video labelling</h1>
        <p className="max-w-2xl text-sm text-muted">
          For each game, watch a bit of the chosen video. Mark it <b className="text-text">Good</b> if it shows what the
          game is and how it plays, without story spoilers, so it would help someone decide whether to buy it.
          Otherwise pick what is wrong with it. Each answer saves straight away; /metrics shows the result.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="tabular-nums">
            {done} of {items.length} labelled{done > 0 && ` · ${good} good (${Math.round((100 * good) / done)}%)`}
          </span>
          <span className="h-2 w-40 rounded-full bg-surface-2">
            <span className="block h-2 rounded-full bg-accent" style={{ width: `${(100 * done) / items.length}%` }} />
          </span>
          <div className="ml-auto flex gap-1 rounded-lg border border-border p-0.5">
            {(["todo", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1 ${filter === f ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
              >
                {f === "todo" ? "To do" : "All"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          All {items.length} games are labelled. Thank you! Switch to “All” to review or change an answer.
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {shown.map((item) => (
            <EvalCard key={item.gameId} item={item} onSaved={(label) => update(item.gameId, label)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EvalCard({ item, onSaved }: { item: EvalItem; onSaved: (label: EvalItem["label"]) => void }) {
  const [playing, setPlaying] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const v = item.video;

  async function save(good: boolean, reason: BadReason | null) {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/admin/video-eval/${item.gameId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ good, reason }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(true);
    setPicking(false);
    onSaved({ good, notes: reason });
  }

  async function clear() {
    setBusy(true);
    const res = await fetch(`/api/admin/video-eval/${item.gameId}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (res?.ok) onSaved(null);
    else setError(true);
  }

  return (
    <li className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{item.title}</h2>
        <span className="shrink-0 text-xs text-muted">{item.releaseStatus.replace("_", " ")}</span>
      </div>

      {v ? (
        <>
          <div className="aspect-video overflow-hidden rounded-lg bg-black">
            {playing ? (
              <iframe
                className="h-full w-full"
                src={`https://www.youtube-nocookie.com/embed/${v.youtubeId}?autoplay=1&rel=0`}
                title={v.title ?? item.title}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <button onClick={() => setPlaying(true)} className="group relative h-full w-full" aria-label={`Play video for ${item.title}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`} alt="" className="h-full w-full object-cover opacity-80 group-hover:opacity-100" />
                <span className="absolute inset-0 m-auto flex h-12 w-16 items-center justify-center rounded-xl bg-black/70 text-xl">▶</span>
              </button>
            )}
          </div>
          <p className="text-xs text-muted">
            {KIND_LABELS[v.kind] ?? v.kind} · {v.channel ?? "unknown channel"}
            {minutes(v.durationSec) && ` · ${minutes(v.durationSec)}`}
            {v.classifiedBy === "llm" && " · LLM-checked"}
            <br />
            <span className="text-text">{v.title}</span>
          </p>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          No video was found for this game. Mark it as a miss below.
        </p>
      )}

      {item.label && !picking ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className={item.label.good ? "text-sale" : "text-muted"}>
            {item.label.good ? "✓ Good" : `✗ Not good${item.label.notes ? `: ${item.label.notes}` : ""}`}
          </span>
          <button onClick={clear} disabled={busy} className="text-xs text-muted underline hover:text-text">
            Change answer
          </button>
        </div>
      ) : picking || !v ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">What&apos;s wrong with it?</p>
          <div className="flex flex-wrap gap-2">
            {(v ? BAD_REASONS.filter((r) => r !== "No video found") : (["No video found"] as const)).map((r) => (
              <button
                key={r}
                disabled={busy}
                onClick={() => save(false, r)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
              >
                {r}
              </button>
            ))}
            {v && (
              <button onClick={() => setPicking(false)} className="px-2 text-sm text-muted hover:text-text">
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => save(true, null)}
            className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg hover:bg-accent-strong disabled:opacity-50"
          >
            Good
          </button>
          <button
            disabled={busy}
            onClick={() => setPicking(true)}
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50"
          >
            Not good
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-400">Couldn&apos;t save. Are you still signed in? Try again.</p>}
    </li>
  );
}
