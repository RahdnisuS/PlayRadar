"use client";

import { useEffect, useRef, useState } from "react";
import { formatPrice } from "@/lib/format";

type Result = {
  id: string;
  recommendationId: string;
  title: string;
  cover_url: string | null;
  release_status: string;
  release_date: string | null;
  tags: string[];
  moods: string[];
  reason: string;
  price_cents: number | null;
  regular_cents: number | null;
  currency: string | null;
};

type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; results: Result[]; usedLlm: boolean };

const EXAMPLES = [
  "Cozy co-op game to play with my partner under ₹800",
  "Something dark and atmospheric, solo, under 15 hours",
  "Fast-paced shooter with friends",
  "Upcoming open-world RPGs",
];

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setTurns((t) => [...t, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sessionId: sessionId.current }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Something went wrong.");
      sessionId.current = data.sessionId;
      setTurns((t) => [...t, { role: "assistant", text: data.reply, results: data.results, usedLlm: data.usedLlm }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="max-h-[70vh] min-h-48 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">Try one of these, or describe it your own way:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  onClick={() => send(e)}
                  className="rounded-full border border-border px-3 py-1 text-sm hover:border-accent hover:text-accent"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent/15 px-3 py-2 text-sm">{t.text}</p>
            </div>
          ) : (
            <div key={i} className="space-y-3">
              <p className="text-sm">{t.text}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {t.results.map((r, rank) => (
                  <ResultCard key={r.recommendationId} result={r} rank={rank + 1} />
                ))}
              </div>
              {!t.usedLlm && t.results.length > 0 && (
                <p className="text-xs text-muted">Answered by our quick matcher (the AI assistant is resting).</p>
              )}
            </div>
          ),
        )}
        {busy && <p className="animate-pulse text-sm text-muted">Searching the catalog…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t border-border p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          placeholder="What do you feel like playing?"
          aria-label="Describe what you want to play"
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          disabled={busy || !input.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function ResultCard({ result: r, rank }: { result: Result; rank: number }) {
  const discount =
    r.price_cents != null && r.regular_cents ? Math.round(((r.regular_cents - r.price_cents) / r.regular_cents) * 100) : 0;
  return (
    <article className="flex gap-3 rounded-lg border border-border bg-surface-2 p-2">
      {r.cover_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.cover_url} alt="" className="h-28 w-20 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-28 w-20 shrink-0 rounded bg-bg" />
      )}
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-semibold leading-tight">
          <span className="mr-1 text-muted">{rank}.</span>
          {r.title}
        </h3>
        <p className="text-xs leading-snug">{r.reason}</p>
        <p className="line-clamp-1 text-xs text-muted">{[...r.moods, ...r.tags].slice(0, 4).join(" · ")}</p>
        <p className="text-xs">
          {r.release_status === "upcoming" ? (
            <span className="text-muted">Upcoming{r.release_date ? ` · ${new Date(r.release_date).getFullYear()}` : ""}</span>
          ) : r.price_cents != null && r.currency ? (
            <>
              {r.price_cents === 0 ? "Free" : formatPrice(r.price_cents, r.currency)}
              {discount > 0 && <span className="ml-1 rounded bg-sale/15 px-1 text-sale">-{discount}%</span>}
            </>
          ) : null}
        </p>
      </div>
    </article>
  );
}
