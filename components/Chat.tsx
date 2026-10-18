"use client";

import { useEffect, useRef, useState } from "react";
import { ResultCard, type Result } from "./ResultCard";

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
    setInput("");
    await request(message, { message, sessionId: sessionId.current });
  }

  async function showSimilar(recommendationId: string) {
    if (busy || !sessionId.current) return;
    await request("Show me similar games", { similarTo: recommendationId, sessionId: sessionId.current });
  }

  async function request(label: string, body: Record<string, unknown>) {
    setTurns((t) => [...t, { role: "user", text: label }]);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      {/* Phones scroll the page itself; a nested 70vh scroller squeezed the five results. */}
      <div className="min-h-48 space-y-4 p-4 sm:max-h-[70vh] sm:overflow-y-auto">
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
                  <ResultCard key={r.recommendationId} result={r} rank={rank + 1} onSimilar={showSimilar} />
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

