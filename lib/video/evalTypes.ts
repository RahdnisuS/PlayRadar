// Shared by the server (lib/video/eval.ts) and the labelling page; no server imports here.
export const BAD_REASONS = ["Spoilers", "Not gameplay", "Wrong game", "Poor quality", "No video found"] as const;
export type BadReason = (typeof BAD_REASONS)[number];

export type EvalItem = {
  gameId: string;
  title: string;
  releaseStatus: string;
  coverUrl: string | null;
  video: { youtubeId: string; kind: string; title: string | null; channel: string | null; durationSec: number | null; classifiedBy: string | null } | null;
  label: { good: boolean; notes: string | null } | null;
};
