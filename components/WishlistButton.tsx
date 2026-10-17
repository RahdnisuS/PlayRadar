"use client";

import { useEffect, useState } from "react";
import { useMe } from "./useMe";
import { WishlistDialog } from "./WishlistDialog";

/** "Wishlist" / "On your wishlist" button that opens the wishlist dialog (or sign-in for guests). */
export function WishlistButton({
  gameId,
  title,
  releaseStatus,
  source = "site",
  className,
  onAdded,
}: {
  gameId: string;
  title: string;
  releaseStatus: string;
  source?: "site" | "chat";
  className?: string;
  onAdded?: () => void;
}) {
  const me = useMe();
  const [onList, setOnList] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!me) return setOnList(false);
    let cancelled = false;
    fetch(`/api/wishlist/${gameId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && d && setOnList(!!d.item))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gameId, me]);

  return (
    <>
      <button onClick={() => setOpen(true)} aria-pressed={onList} className={className}>
        {onList ? "✓ On your wishlist" : "♡ Wishlist"}
      </button>
      {open && (
        <WishlistDialog
          gameId={gameId}
          title={title}
          releaseStatus={releaseStatus}
          source={source}
          onClose={() => setOpen(false)}
          onChange={(item, added) => {
            setOnList(!!item);
            if (added) onAdded?.();
          }}
        />
      )}
    </>
  );
}
