// YouTube Data API v3 with a daily unit budget (10,000/day free; search = 100, videos.list = 1).
// Usage is counted in llm_usage_daily under the scope "youtube:units".
import { q } from "../db";
import type { Candidate } from "./rules";

const API = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_DAILY_UNITS = 9000; // headroom below the 10,000 quota

export class QuotaExhaustedError extends Error {}

async function spend(units: number) {
  const [row] = await q<{ ok: boolean }>(`SELECT try_consume_llm(ARRAY['youtube:units'], ARRAY[$1::int], $2) AS ok`, [
    YOUTUBE_DAILY_UNITS,
    units,
  ]);
  if (!row.ok) throw new QuotaExhaustedError("YouTube daily budget used up");
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, key: process.env.YOUTUBE_API_KEY! });
  const r = await fetch(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(10000) });
  if (r.status === 403) throw new QuotaExhaustedError(`YouTube 403: ${(await r.text()).slice(0, 120)}`);
  if (!r.ok) throw new Error(`YouTube ${path} ${r.status}`);
  return r.json();
}

/** ISO-8601 duration (PT12M3S) to seconds. */
export function parseDuration(iso: string): number {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

/** 100 units. "medium" = 4-20 minutes, which covers our 8-15 minute target. */
export async function searchVideoIds(query: string): Promise<string[]> {
  await spend(100);
  const j = await get<{ items: { id: { videoId: string } }[] }>("search", {
    part: "id",
    q: query,
    type: "video",
    videoDuration: "medium",
    videoEmbeddable: "true",
    maxResults: "15",
    relevanceLanguage: "en",
    safeSearch: "moderate",
  });
  return j.items.map((i) => i.id.videoId);
}

type VideoItem = {
  id: string;
  snippet: { title: string; channelTitle: string; description: string };
  contentDetails: { duration: string; regionRestriction?: { blocked?: string[] } };
  status: { embeddable: boolean; privacyStatus: string };
};

/** 1 unit per call (up to 50 ids). Also used to re-check that cached videos still exist. */
export async function videoDetails(ids: string[]): Promise<Candidate[]> {
  if (!ids.length) return [];
  await spend(1);
  const j = await get<{ items: VideoItem[] }>("videos", { part: "snippet,contentDetails,status", id: ids.slice(0, 50).join(",") });
  return j.items.map((v) => ({
    youtubeId: v.id,
    title: v.snippet.title,
    channelTitle: v.snippet.channelTitle,
    description: v.snippet.description.slice(0, 300),
    durationSec: parseDuration(v.contentDetails.duration),
    // Our default region is India; treat videos blocked there as unusable.
    embeddable:
      v.status.embeddable && v.status.privacyStatus === "public" && !v.contentDetails.regionRestriction?.blocked?.includes("IN"),
  }));
}
