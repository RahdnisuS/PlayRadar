"use client";

import { useState } from "react";

/** Email field that sends a magic link; after sending it shows "check your inbox". */
export function SignInForm({ intro, next }: { intro?: React.ReactNode; next?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, next: next ?? window.location.pathname }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Couldn't send the email. Please try again.");
      setState("sent");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium">Check your inbox</p>
        <p className="text-muted">
          We sent a sign-in link to <span className="text-text">{email}</span>. Open it on this device to sign in. It can
          take a minute to arrive; check your spam folder if you don&apos;t see it.
        </p>
        <button onClick={() => setState("idle")} className="text-xs text-accent underline">
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      {intro && <div className="text-muted">{intro}</div>}
      <label className="block space-y-1">
        <span className="text-xs text-muted">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 outline-none focus:border-accent"
        />
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={state === "sending"}
        className="w-full rounded-md bg-accent px-3 py-2 font-medium text-bg hover:bg-accent-strong disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      <p className="text-xs text-muted">No password needed. We only email you about games you choose to track.</p>
    </form>
  );
}
