"use client";

import { useEffect, useState } from "react";
import type { WishlistItemResponse } from "@/app/api/wishlist/[gameId]/route";
import { formatPrice } from "@/lib/format";
import type { WishlistSettings } from "@/lib/wishlist";
import { Modal } from "./Modal";
import { SignInForm } from "./SignInForm";
import { refreshMe } from "./useMe";

export const SAVED_HERE_ONLY =
  "Saved on PlayRadar only. This doesn't change your Steam or Epic wishlist.";

/** Add / edit / remove one wishlist item. Guests get the sign-in form instead. Mount it only while open. */
export function WishlistDialog({
  gameId,
  title,
  releaseStatus,
  source = "site",
  onClose,
  onChange,
}: {
  gameId: string;
  title: string;
  releaseStatus: string;
  source?: "site" | "chat";
  onClose: () => void;
  onChange?: (item: WishlistSettings | null, added: boolean) => void;
}) {
  const [data, setData] = useState<WishlistItemResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [target, setTarget] = useState("");
  const [anySale, setAnySale] = useState(true);
  const [atl, setAtl] = useState(true);
  const [release, setRelease] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/wishlist/${gameId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: WishlistItemResponse) => {
        if (cancelled) return;
        setData(d);
        const it = d.item;
        if (it) {
          if (it.targetCents != null && it.targetCurrency === d.currency) setTarget(String(it.targetCents / 100));
          setAnySale(it.alertOnAnySale);
          setAtl(it.alertOnAllTimeLow);
          setRelease(it.alertOnRelease);
        }
      })
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const t = target.trim().replace(/,/g, "");
    const targetPrice = t ? Number(t) : null;
    if (targetPrice != null && !(targetPrice > 0)) return setError("Enter a target price above zero, or leave it empty.");
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/wishlist/${gameId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPrice, alertOnAnySale: anySale, alertOnAllTimeLow: atl, alertOnRelease: release, source }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? "Couldn't save. Please try again.");
      onChange?.(body.item, !data?.item);
      refreshMe();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/wishlist/${gameId}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      onChange?.(null, false);
      refreshMe();
      onClose();
    } catch {
      setError("Couldn't remove it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const old = data?.item;
  const otherCurrencyTarget = old?.targetCents != null && old.targetCurrency && old.targetCurrency !== data?.currency;

  return (
    <Modal title={old ? `Edit wishlist: ${title}` : `Wishlist ${title}`} onClose={onClose}>
      {loadError && <p className="text-sm text-red-400">Couldn&apos;t load your wishlist. Please try again in a moment.</p>}
      {!data && !loadError && <div className="h-32 animate-pulse rounded bg-bg/60" />}
      {data && !data.signedIn && (
        <SignInForm
          intro={
            <>
              Sign in to save <span className="text-text">{title}</span> to your PlayRadar wishlist. We&apos;ll email you the
              actual price when it goes on sale. {SAVED_HERE_ONLY}
            </>
          }
        />
      )}
      {data?.signedIn && (
        <form onSubmit={save} className="space-y-4 text-sm">
          <label className="block space-y-1">
            <span className="text-xs text-muted">Target price (optional)</span>
            <div className="flex items-center gap-2">
              <span className="text-muted">{data.symbol}</span>
              <input
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="Any price"
                className="w-32 rounded-md border border-border bg-bg px-3 py-2 outline-none focus:border-accent"
              />
              <span className="text-xs text-muted">{data.currency}</span>
            </div>
            <span className="block text-xs text-muted">We&apos;ll email you when the price drops to this or lower.</span>
            {otherCurrencyTarget && (
              <span className="block text-xs text-muted">
                Your current target is {formatPrice(old!.targetCents!, old!.targetCurrency!)}, set for another region. Saving
                replaces it with a {data.currency} target (or none, if left empty).
              </span>
            )}
          </label>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs text-muted">Also email me when</legend>
            <Toggle checked={anySale} onChange={setAnySale}>it goes on sale</Toggle>
            <Toggle checked={atl} onChange={setAtl}>it hits its all-time low</Toggle>
            {releaseStatus !== "released" && (
              <Toggle checked={release} onChange={setRelease}>
                it&apos;s {releaseStatus === "early_access" ? "fully released" : "released"}
              </Toggle>
            )}
          </fieldset>

          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-xs text-muted">{SAVED_HERE_ONLY}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-accent px-3 py-2 font-medium text-bg hover:bg-accent-strong disabled:opacity-60"
            >
              {old ? "Save changes" : "Add to wishlist"}
            </button>
            {old && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="rounded-md border border-border px-3 py-2 hover:border-red-400 hover:text-red-400 disabled:opacity-60"
              >
                Remove from wishlist
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
      {children}
    </label>
  );
}
