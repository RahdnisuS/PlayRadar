"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/format";
import { BuyDialog } from "./BuyDialog";
import { GameDialog } from "./GameDialog";
import { VideoPlayer } from "./VideoPlayer";
import { WishlistButton } from "./WishlistButton";

export type Result = {
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
  lowest_cents: number | null;
  currency: string | null;
  stores: { shop: "steam" | "epic"; url: string; app_link: string | null }[];
  video_youtube_id: string | null;
};

type Phase = "idle" | "loading" | "playing" | "asking" | "hidden" | "novideo";

export function logEvent(recommendationId: string, type: string, store?: string) {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recommendationId, type, store }),
    keepalive: true,
  }).catch(() => {});
}

export function ResultCard({ result: r, rank, onSimilar }: { result: Result; rank: number; onSimilar: (recId: string) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [videoId, setVideoId] = useState<string | null>(r.video_youtube_id);
  const [buyOpen, setBuyOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  async function watch() {
    if (videoId) return setPhase("playing");
    setPhase("loading");
    try {
      const res = await fetch(`/api/games/${r.id}/video`);
      const { video } = await res.json();
      if (video?.youtubeId) {
        setVideoId(video.youtubeId);
        setPhase("playing");
      } else setPhase("novideo");
    } catch {
      setPhase("novideo");
    }
  }

  if (phase === "hidden") {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted sm:col-span-2 lg:col-span-3">
        Got it, we&apos;ll skip <span className="text-text">{r.title}</span> from now on.
      </p>
    );
  }

  const discount =
    r.price_cents != null && r.regular_cents ? Math.round(((r.regular_cents - r.price_cents) / r.regular_cents) * 100) : 0;
  const atl = discount > 0 && r.lowest_cents != null && r.price_cents! <= r.lowest_cents;
  const expanded = phase === "playing" || phase === "asking";

  return (
    <article className={`space-y-3 rounded-lg border border-border bg-surface-2 p-2 ${expanded ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      <div className="flex gap-3">
        <button onClick={() => setDetailsOpen(true)} aria-label={`More about ${r.title}`} className="shrink-0 rounded hover:opacity-80">
          {r.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.cover_url} alt="" className="h-28 w-20 rounded object-cover" />
          ) : (
            <div className="h-28 w-20 rounded bg-bg" />
          )}
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold leading-tight">
            <span className="mr-1 text-muted">{rank}.</span>
            <button onClick={() => setDetailsOpen(true)} className="text-left hover:text-accent hover:underline">
              {r.title}
            </button>
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
                {atl && <span className="ml-1 rounded bg-sale/15 px-1 text-sale">All-time low</span>}
              </>
            ) : (
              <span className="text-muted">Price unavailable in your region</span>
            )}
          </p>
          {phase === "idle" && (
            <div className="mt-1 flex flex-wrap gap-2">
              <button onClick={watch} className="rounded-md bg-accent/15 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/25">
                ▶ Watch {r.release_status === "upcoming" ? "trailer" : "gameplay"}
              </button>
              <button onClick={() => setBuyOpen(true)} className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent hover:text-accent">
                Compare prices
              </button>
            </div>
          )}
          {phase === "loading" && <p className="animate-pulse text-xs text-muted">Finding a spoiler-free video…</p>}
          {phase === "novideo" && (
            <div className="space-y-1">
              <p className="text-xs text-muted">No spoiler-free video found for this one.</p>
              <button onClick={() => setPhase("asking")} className="text-xs text-accent underline">Show options</button>
            </div>
          )}
        </div>
      </div>

      {phase === "playing" && videoId && (
        <VideoPlayer
          youtubeId={videoId}
          title={`${r.title} video`}
          onPlay={() => logEvent(r.recommendationId, "video_played")}
          onEnd={() => {
            logEvent(r.recommendationId, "video_finished");
            setPhase("asking");
          }}
          onClose={() => setPhase("asking")}
        />
      )}

      {phase === "asking" && (
        <div className="space-y-2 rounded-md bg-bg/60 p-2">
          <p className="text-sm">Did that look good?</p>
          <div className="flex flex-wrap gap-2">
            <Choice onClick={() => { logEvent(r.recommendationId, "liked"); setBuyOpen(true); }} primary>
              Buy now
            </Choice>
            <WishlistButton
              gameId={r.id}
              title={r.title}
              releaseStatus={r.release_status}
              source="chat"
              onAdded={() => logEvent(r.recommendationId, "wishlisted")}
              className={CHOICE_CLASS}
            />
            <Choice onClick={() => onSimilar(r.recommendationId)}>Show similar</Choice>
            <Choice onClick={() => { logEvent(r.recommendationId, "not_interested"); setPhase("hidden"); }}>Not for me</Choice>
          </div>
        </div>
      )}

      {buyOpen && (
        <BuyDialog
          gameId={r.id}
          title={r.title}
          onClose={() => setBuyOpen(false)}
          onStoreClick={(shop) => logEvent(r.recommendationId, "store_click", shop)}
        />
      )}
      {detailsOpen && (
        <GameDialog
          gameId={r.id}
          title={r.title}
          onClose={() => setDetailsOpen(false)}
          onStoreClick={(shop) => logEvent(r.recommendationId, "store_click", shop)}
          onVideoPlay={() => logEvent(r.recommendationId, "video_played")}
          onWishlisted={() => logEvent(r.recommendationId, "wishlisted")}
        />
      )}
    </article>
  );
}

const CHOICE_CLASS = "rounded-full border border-border px-3 py-1 text-xs font-medium hover:border-accent hover:text-accent";

function Choice({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={primary ? "rounded-full bg-accent px-3 py-1 text-xs font-medium text-bg" : CHOICE_CLASS}
    >
      {children}
    </button>
  );
}
