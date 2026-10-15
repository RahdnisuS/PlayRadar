"use client";

import { useEffect, useRef } from "react";

/** Native <dialog> shown as a modal while mounted: Esc, the × button and a backdrop click all close it. */
export function Modal({
  title,
  subtitle,
  onClose,
  wide,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useRef(`modal-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    const d = ref.current;
    // No close() on cleanup: unmounting removes the dialog, and a close event would re-trigger onClose.
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={titleId}
      className={`m-auto max-h-[calc(100dvh-2rem)] rounded-xl border border-border bg-surface p-0 text-text backdrop:bg-black/70 ${
        wide ? "w-[min(64rem,calc(100vw-2rem))]" : "w-[min(40rem,calc(100vw-2rem))]"
      }`}
    >
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold leading-tight">{title}</h2>
          {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
        </div>
        <CloseButton onClick={onClose} label="Close" />
      </header>
      <div className="p-4">{children}</div>
    </dialog>
  );
}

export function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
