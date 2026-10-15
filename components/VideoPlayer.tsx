"use client";

import { useEffect, useRef } from "react";
import { CloseButton } from "./Modal";

// Minimal typings for the YouTube IFrame API.
type YTPlayer = { destroy(): void };
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, number | string>;
      events?: { onStateChange?: (e: { data: number }) => void };
    },
  ) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number };
};
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return apiPromise;
}

export function VideoPlayer({
  youtubeId,
  title,
  onPlay,
  onEnd,
  onClose,
  autoplay = true,
}: {
  youtubeId: string;
  autoplay?: boolean;
  title: string;
  onPlay?: () => void;
  onEnd?: () => void;
  /** When given, a bar above the video shows the title and a close (×) button at the top right. */
  onClose?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const played = useRef(false);
  const callbacks = useRef({ onPlay, onEnd });
  callbacks.current = { onPlay, onEnd };

  useEffect(() => {
    let player: YTPlayer | null = null;
    let cancelled = false;
    loadApi().then((YT) => {
      if (cancelled || !host.current) return;
      player = new YT.Player(host.current, {
        videoId: youtubeId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { autoplay: autoplay ? 1 : 0, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING && !played.current) {
              played.current = true;
              callbacks.current.onPlay?.();
            }
            if (e.data === YT.PlayerState.ENDED) callbacks.current.onEnd?.();
          },
        },
      });
    });
    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, [youtubeId, autoplay]);

  return (
    <div className="overflow-hidden rounded-lg bg-black">
      {onClose && (
        <div className="flex items-center justify-between gap-2 bg-bg/80 py-1 pl-3 pr-1">
          <p className="truncate text-xs text-muted">{title}</p>
          <CloseButton onClick={onClose} label="Close video" />
        </div>
      )}
      <div className="relative aspect-video w-full">
        <div ref={host} className="absolute inset-0 h-full w-full [&>iframe]:h-full [&>iframe]:w-full" title={title} />
      </div>
    </div>
  );
}
