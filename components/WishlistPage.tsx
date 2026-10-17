"use client";

import { useCallback, useEffect, useState } from "react";
import type { Me } from "@/app/api/me/route";
import type { WishlistResponse } from "@/app/api/wishlist/route";
import { formatPrice } from "@/lib/format";
import type { WishlistItem } from "@/lib/wishlist";
import { GameDialog } from "./GameDialog";
import { SignInForm } from "./SignInForm";
import { refreshMe, useMe } from "./useMe";
import { SAVED_HERE_ONLY, WishlistDialog } from "./WishlistDialog";

type Digest = NonNullable<Me["user"]>["emailDigest"];

const DIGESTS: { value: Digest; label: string }[] = [
  { value: "instant", label: "Right away, one email per alert" },
  { value: "daily", label: "Once a day, in one email" },
  { value: "weekly", label: "Once a week, in one email" },
  { value: "off", label: "Never (pause all wishlist emails)" },
];

/** /wishlist: the signed-in user's items with prices in their region, plus email preferences. */
export function WishlistPage() {
  const me = useMe();
  const [data, setData] = useState<WishlistResponse | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<WishlistItem | null>(null);
  const [viewing, setViewing] = useState<WishlistItem | null>(null);

  const load = useCallback(() => {
    fetch("/api/wishlist")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: WishlistResponse) => {
        setData(d);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    if (me) load();
  }, [me, load]);

  if (me === undefined) return <div className="h-40 animate-pulse rounded-lg bg-surface" />;

  if (!me) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-surface p-6">
        <h1 className="text-xl font-semibold">Your wishlist</h1>
        <SignInForm
          next="/wishlist"
          intro={<>Sign in to see your wishlist and email settings. {SAVED_HERE_ONLY}</>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold">Your wishlist</h1>
          <p className="text-xs text-muted">{SAVED_HERE_ONLY}</p>
        </div>
        {error && <p className="text-sm text-red-400">Couldn&apos;t load your wishlist. Please refresh the page.</p>}
        {!data && !error && <div className="h-32 animate-pulse rounded-lg bg-surface" />}
        {data && data.items.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
            Nothing here yet. Open any game from the chat or the search box and press <span className="text-text">♡ Wishlist</span>.
          </p>
        )}
        {data && data.items.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.items.map((it) => (
              <Row key={it.gameId} item={it} onEdit={() => setEditing(it)} onOpen={() => setViewing(it)} />
            ))}
          </ul>
        )}
      </section>

      <EmailPrefs digest={me.emailDigest} freeGames={me.freeGameAlerts} />

      {editing && (
        <WishlistDialog
          gameId={editing.gameId}
          title={editing.title}
          releaseStatus={editing.releaseStatus}
          onClose={() => setEditing(null)}
          onChange={load}
        />
      )}
      {viewing && <GameDialog gameId={viewing.gameId} title={viewing.title} onClose={() => { setViewing(null); load(); }} />}
    </div>
  );
}

function Row({ item: it, onEdit, onOpen }: { item: WishlistItem; onEdit: () => void; onOpen: () => void }) {
  const discount =
    it.priceCents != null && it.regularCents ? Math.round(((it.regularCents - it.priceCents) / it.regularCents) * 100) : 0;
  const atl = discount > 0 && it.lowestCents != null && it.priceCents! <= it.lowestCents;
  const alerts = [
    it.targetCents != null && it.targetCurrency ? `at ${formatPrice(it.targetCents, it.targetCurrency)} or less` : null,
    it.alertOnAnySale ? "any sale" : null,
    it.alertOnAllTimeLow ? "all-time low" : null,
    it.releaseStatus !== "released" && it.alertOnRelease ? "release" : null,
  ].filter(Boolean);

  return (
    <li className="flex gap-3 rounded-lg border border-border bg-surface-2 p-2">
      <button onClick={onOpen} aria-label={`More about ${it.title}`} className="shrink-0 rounded hover:opacity-80">
        {it.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={it.coverUrl} alt="" className="h-24 w-[4.5rem] rounded object-cover" />
        ) : (
          <div className="h-24 w-[4.5rem] rounded bg-bg" />
        )}
      </button>
      <div className="min-w-0 flex-1 space-y-1 text-xs">
        <button onClick={onOpen} className="text-left text-sm font-semibold leading-tight hover:text-accent hover:underline">
          {it.title}
        </button>
        <p>
          {it.releaseStatus === "upcoming" ? (
            <span className="text-muted">Upcoming{it.releaseDate ? ` · ${new Date(it.releaseDate).getFullYear()}` : ""}</span>
          ) : it.priceCents != null && it.currency ? (
            <>
              {it.priceCents === 0 ? "Free" : formatPrice(it.priceCents, it.currency)}
              {discount > 0 && <span className="ml-1 rounded bg-sale/15 px-1 text-sale">-{discount}%</span>}
              {atl && <span className="ml-1 rounded bg-sale/15 px-1 text-sale">All-time low</span>}
            </>
          ) : (
            <span className="text-muted">Price unavailable in your region</span>
          )}
        </p>
        <p className="text-muted">{alerts.length ? `Email me: ${alerts.join(", ")}` : "No alerts on"}</p>
        <button onClick={onEdit} className="rounded-md border border-border px-2 py-1 hover:border-accent hover:text-accent">
          Edit alerts
        </button>
      </div>
    </li>
  );
}

function EmailPrefs({ digest: initialDigest, freeGames: initialFree }: { digest: Digest; freeGames: boolean }) {
  const [digest, setDigest] = useState(initialDigest);
  const [freeGames, setFreeGames] = useState(initialFree);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(patch: { emailDigest?: Digest; freeGameAlerts?: boolean }) {
    setStatus("saving");
    try {
      const r = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error();
      setStatus("saved");
      refreshMe();
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="max-w-xl space-y-3 rounded-xl border border-border bg-surface p-4 text-sm">
      <h2 className="font-semibold">Email preferences</h2>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs text-muted">Send my wishlist alerts</legend>
        {DIGESTS.map((d) => (
          <label key={d.value} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="digest"
              checked={digest === d.value}
              onChange={() => {
                setDigest(d.value);
                save({ emailDigest: d.value });
              }}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            {d.label}
          </label>
        ))}
      </fieldset>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={freeGames}
          onChange={(e) => {
            setFreeGames(e.target.checked);
            save({ freeGameAlerts: e.target.checked });
          }}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Also tell me when Epic gives a game away for free
      </label>
      <p className="h-4 text-xs text-muted" aria-live="polite">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved." : status === "error" ? "Couldn't save. Please try again." : ""}
      </p>
      <p className="text-xs text-muted">Every email also has a one-click unsubscribe link.</p>
    </section>
  );
}
