"use client";

import { useEffect, useState } from "react";
import type { Me } from "@/app/api/me/route";

// One shared /api/me request per page; call refreshMe() after sign-out or a wishlist change.
let pending: Promise<Me> | null = null;
const listeners = new Set<(me: Me) => void>();

function load(): Promise<Me> {
  pending ??= fetch("/api/me")
    .then((r) => (r.ok ? r.json() : { user: null }))
    .catch(() => ({ user: null }));
  return pending;
}

export function refreshMe() {
  pending = null;
  load().then((me) => listeners.forEach((l) => l(me)));
}

/** undefined while loading, then the signed-in user or null for guests. */
export function useMe(): Me["user"] | undefined {
  const [me, setMe] = useState<Me["user"] | undefined>(undefined);
  useEffect(() => {
    const l = (m: Me) => setMe(m.user);
    listeners.add(l);
    load().then(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return me;
}
