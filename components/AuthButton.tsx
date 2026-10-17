"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { SignInForm } from "./SignInForm";
import { refreshMe, useMe } from "./useMe";

const LINK_PROBLEM: Record<string, string> = {
  expired: "That sign-in link has expired or was already used. Enter your email for a new one.",
  invalid: "That sign-in link didn't work. Enter your email for a new one.",
};

/** Header account control: "Sign in" for guests, a small menu (wishlist, sign out) when signed in. */
export function AuthButton() {
  const me = useMe();
  const router = useRouter();
  const [signInOpen, setSignInOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // /auth/confirm redirects to /?signin=expired|invalid when a magic link fails.
  useEffect(() => {
    const url = new URL(window.location.href);
    const p = url.searchParams.get("signin");
    if (p && LINK_PROBLEM[p]) {
      setProblem(LINK_PROBLEM[p]);
      setSignInOpen(true);
      url.searchParams.delete("signin");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  async function signOut() {
    setMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    refreshMe();
    router.refresh();
  }

  if (me === undefined) return <div className="h-7 w-16 shrink-0" aria-hidden />;

  if (!me) {
    return (
      <>
        <button
          onClick={() => setSignInOpen(true)}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:border-accent hover:text-accent"
        >
          Sign in
        </button>
        {signInOpen && (
          <Modal title="Sign in to PlayRadar" onClose={() => { setSignInOpen(false); setProblem(null); }}>
            <SignInForm
              intro={
                problem ?? "Sign in to keep a wishlist on PlayRadar and get emails that show the actual price when a game goes on sale."
              }
            />
          </Modal>
        )}
      </>
    );
  }

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={me.email}
        className="grid h-7 w-7 place-items-center rounded-full bg-accent/15 text-xs font-semibold uppercase text-accent hover:bg-accent/25"
      >
        {me.email[0]}
      </button>
      {menuOpen && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-border bg-surface p-1 text-sm shadow-lg">
          <p className="truncate px-3 py-2 text-xs text-muted">{me.email}</p>
          <Link
            role="menuitem"
            href="/wishlist"
            onClick={() => setMenuOpen(false)}
            className="flex justify-between rounded-md px-3 py-2 hover:bg-surface-2"
          >
            My wishlist <span className="text-muted">{me.wishlistCount}</span>
          </Link>
          <button role="menuitem" onClick={signOut} className="w-full rounded-md px-3 py-2 text-left hover:bg-surface-2">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
