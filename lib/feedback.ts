// Feedback loop: events nudge the user's per-tag affinity (used by match_games as a ranking boost),
// and "not interested" hides the game from that user's future results.
import { q } from "./db";

const WEIGHTS: Record<string, number> = {
  video_played: 0,
  video_finished: 1,
  liked: 1,
  wishlisted: 2,
  store_click: 1.5,
  disliked: -1,
  not_interested: -2,
};

export async function applyFeedback(userId: string, gameId: string, type: string) {
  const w = WEIGHTS[type] ?? 0;
  if (w !== 0) {
    // Mood/genre/theme tags only; spread the weight so games with many tags don't dominate.
    await q(
      `WITH t AS (
         SELECT gt.tag_id, count(*) OVER () AS n FROM game_tags gt JOIN tags tg ON tg.id = gt.tag_id
         WHERE gt.game_id = $2 AND tg.kind IN ('genre','theme','mood')
       )
       INSERT INTO user_tag_affinity (user_id, tag_id, weight, updated_at)
       SELECT $1, tag_id, GREATEST(LEAST($3 * 3.0 / GREATEST(n, 3), 10), -10), now() FROM t
       ON CONFLICT (user_id, tag_id) DO UPDATE SET
         weight = GREATEST(LEAST(user_tag_affinity.weight + EXCLUDED.weight, 10), -10), updated_at = now()`,
      [userId, gameId, w],
    );
  }
  if (type === "not_interested") {
    await q(`INSERT INTO user_excluded_games (user_id, game_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, gameId]);
  }
}
