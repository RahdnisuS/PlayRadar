"use client";

import { useEffect, useState } from "react";
import type { GameDetails } from "@/lib/catalog/details";
import type { ShopCode } from "@/lib/prices/provider";
import { Modal } from "./Modal";
import { PricePanel } from "./PricePanel";
import { VideoPlayer } from "./VideoPlayer";

type VideoState = { status: "loading" } | { status: "ready"; youtubeId: string } | { status: "none" };

const STATUS_LABEL: Record<GameDetails["release_status"], string> = {
  released: "Released",
  upcoming: "Upcoming",
  early_access: "Early access",
};

/**
 * Game popup: video, description, genres and the Steam vs Epic store section. Mount it only while open.
 * The video is selected on open (cached after the first time), like clicking Watch on a result card.
 */
export function GameDialog({
  gameId,
  title,
  onClose,
  onStoreClick,
  onVideoPlay,
}: {
  gameId: string;
  title: string;
  onClose: () => void;
  onStoreClick?: (shop: ShopCode) => void;
  onVideoPlay?: () => void;
}) {
  const [game, setGame] = useState<GameDetails | null>(null);
  const [error, setError] = useState(false);
  const [video, setVideo] = useState<VideoState>({ status: "loading" });
  const [fullSummary, setFullSummary] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/games/${gameId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((g: GameDetails) => {
        if (cancelled) return;
        setGame(g);
        if (g.video_youtube_id) return setVideo({ status: "ready", youtubeId: g.video_youtube_id });
        return fetch(`/api/games/${gameId}/video`)
          .then((r) => r.json())
          .then(({ video: v }) => !cancelled && setVideo(v?.youtubeId ? { status: "ready", youtubeId: v.youtubeId } : { status: "none" }));
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setVideo({ status: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const year = game?.release_date ? new Date(game.release_date).getFullYear() : null;
  const subtitle = game && (
    <>
      {STATUS_LABEL[game.release_status]}
      {year ? ` · ${year}` : ""}
      {game.developer ? ` · ${game.developer}` : ""}
      {game.publisher && game.publisher !== game.developer ? ` / ${game.publisher}` : ""}
    </>
  );

  return (
    <Modal title={game?.title ?? title} subtitle={subtitle} onClose={onClose} wide>
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
          <div>
            {video.status === "ready" ? (
              <VideoPlayer youtubeId={video.youtubeId} title={`${title} video`} autoplay={false} onPlay={onVideoPlay} />
            ) : (
              <div className="grid aspect-video place-items-center rounded-lg bg-bg text-center text-xs text-muted">
                {video.status === "loading" ? (
                  <span className="animate-pulse">Finding a spoiler-free video…</span>
                ) : (
                  <span className="px-4">No spoiler-free video for this one yet.</span>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-3">
            {error && <p className="text-sm text-red-400">Couldn&apos;t load this game. Please try again in a moment.</p>}
            {!game && !error && <div className="h-40 animate-pulse rounded bg-bg/60" />}
            {game && (
              <>
                <Facts game={game} />
                {game.summary && (
                  <div className="space-y-1">
                    <p className={`text-sm leading-relaxed ${fullSummary ? "" : "line-clamp-6"}`}>{game.summary}</p>
                    {game.summary.length > 320 && (
                      <button onClick={() => setFullSummary((v) => !v)} className="text-xs text-accent underline">
                        {fullSummary ? "Show less" : "Read more"}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Where to buy</h3>
          <PricePanel gameId={gameId} onStoreClick={onStoreClick} />
        </section>
      </div>
    </Modal>
  );
}

function Facts({ game }: { game: GameDetails }) {
  const modes = [
    ...game.modes,
    game.is_coop && !game.modes.some((m) => /co-?op/i.test(m)) ? "Co-op" : null,
    game.is_multiplayer && !game.modes.some((m) => /multiplayer/i.test(m)) ? "Multiplayer" : null,
  ].filter((m): m is string => !!m);
  return (
    <dl className="space-y-2 text-xs">
      <Row label="Genres" items={game.genres} />
      <Row label="Themes" items={game.themes} />
      <Row label="Mood" items={game.moods} />
      <Row label="Modes" items={modes} />
      {game.avg_playtime_hrs != null && game.avg_playtime_hrs > 0 && (
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-muted">Length</dt>
          <dd>About {Math.round(game.avg_playtime_hrs)} hours (main story)</dd>
        </div>
      )}
    </dl>
  );
}

function Row({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 pt-0.5 text-muted">{label}</dt>
      <dd className="flex flex-wrap gap-1">
        {items.map((t) => (
          <span key={t} className="rounded-full border border-border px-2 py-0.5">
            {t}
          </span>
        ))}
      </dd>
    </div>
  );
}
