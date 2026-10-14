"use client";

import { useEffect, useRef } from "react";

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
}: {
  youtubeId: string;
  title: string;
  onPlay: () => void;
  onEnd: () => void;
  onClose: () => void;
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
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING && !played.current) {
              played.current = true;
              callbacks.current.onPlay();
            }
            if (e.data === YT.PlayerState.ENDED) callbacks.current.onEnd();
          },
        },
      });
    });
    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, [youtubeId]);

  return (
    <div className="space-y-1">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <div ref={host} className="absolute inset-0 h-full w-full [&>iframe]:h-full [&>iframe]:w-full" title={title} />
      </div>
      <button onClick={onClose} className="text-xs text-muted underline hover:text-text">
        Close video
      </button>
    </div>
  );
}
