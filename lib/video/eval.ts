// The hand-labelled video evaluation set (lib/video/evalSet.json, picked by scripts/prepare-video-eval.ts).
// A "good" label stores the selected video's id as acceptable; "not good" stores none, with the reason in notes.
// /metrics counts a game as correct when its currently selected video is among the acceptable ids.
import { q } from "../db";
import evalSet from "./evalSet.json";
import type { BadReason, EvalItem } from "./evalTypes";

export const EVAL_GAME_IDS: string[] = evalSet.gameIds;

export async function listEvalItems(): Promise<EvalItem[]> {
  const rows = await q<{
    game_id: string; title: string; release_status: string; cover_url: string | null;
    youtube_id: string | null; kind: string | null; video_title: string | null; channel_title: string | null;
    duration_sec: number | null; classified_by: string | null; acceptable: string[] | null; notes: string | null; labelled: boolean;
  }>(
    `SELECT g.id AS game_id, g.title, g.release_status, g.cover_url,
            v.youtube_id, v.kind, v.title AS video_title, v.channel_title, v.duration_sec, v.classified_by,
            l.acceptable_youtube_ids AS acceptable, l.notes, l.game_id IS NOT NULL AS labelled
     FROM unnest($1::bigint[]) WITH ORDINALITY AS s(id, ord)
     JOIN games g ON g.id = s.id
     LEFT JOIN videos v ON v.game_id = g.id AND v.is_selected AND v.status = 'ok'
     LEFT JOIN video_eval_labels l ON l.game_id = g.id
     ORDER BY s.ord`,
    [EVAL_GAME_IDS],
  );
  return rows.map((r) => ({
    gameId: String(r.game_id),
    title: r.title,
    releaseStatus: r.release_status,
    coverUrl: r.cover_url,
    video: r.youtube_id
      ? { youtubeId: r.youtube_id, kind: r.kind!, title: r.video_title, channel: r.channel_title, durationSec: r.duration_sec, classifiedBy: r.classified_by }
      : null,
    label: r.labelled ? { good: !!r.youtube_id && (r.acceptable ?? []).includes(r.youtube_id), notes: r.notes } : null,
  }));
}

/** Saves the user's verdict on a game's currently selected video. Returns false if the game isn't in the set. */
export async function saveEvalLabel(gameId: string, good: boolean, reason: BadReason | null): Promise<boolean> {
  if (!EVAL_GAME_IDS.includes(gameId)) return false;
  const [v] = await q<{ id: string; youtube_id: string }>(
    `SELECT id, youtube_id FROM videos WHERE game_id = $1 AND is_selected AND status = 'ok'`,
    [gameId],
  );
  if (good && !v) return false;
  await q(
    `INSERT INTO video_eval_labels (game_id, acceptable_youtube_ids, notes, labelled_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (game_id) DO UPDATE SET acceptable_youtube_ids = EXCLUDED.acceptable_youtube_ids,
       notes = EXCLUDED.notes, labelled_at = now()`,
    [gameId, good ? [v!.youtube_id] : [], good ? null : reason],
  );
  if (v) await q(`UPDATE videos SET human_verified = true, last_verified_at = now() WHERE id = $1`, [v.id]);
  return true;
}

export async function clearEvalLabel(gameId: string) {
  await q(`DELETE FROM video_eval_labels WHERE game_id = $1`, [gameId]);
}
