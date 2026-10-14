// Picks one spoiler-free video per game and caches it in `videos`, so each game is classified only once.
//  - upcoming: the official trailer from IGDB's video list (no search quota)
//  - released: YouTube search for a gameplay overview, judged by rules; the LLM only sees borderline videos
import { q } from "../db";
import { groqJson } from "../llm/groq";
import { tryConsume } from "../llm/caps";
import { ACCEPT, BORDERLINE, judgeOverview, pickTrailer, type Candidate } from "./rules";
import { QuotaExhaustedError, searchVideoIds, videoDetails } from "./youtube";

export type SelectedVideo = { id: string; youtubeId: string; kind: string; title: string | null; channel: string | null };

type GameRow = {
  id: string;
  title: string;
  developer: string | null;
  publisher: string | null;
  release_status: string;
  external_ids: { igdb_videos?: { id: string; name: string }[] };
};

export async function getSelectedVideo(gameId: string | number): Promise<SelectedVideo | null> {
  const [row] = await q<SelectedVideo>(
    `SELECT id, youtube_id AS "youtubeId", kind, title, channel_title AS channel FROM videos
     WHERE game_id = $1 AND is_selected AND status = 'ok'`,
    [gameId],
  );
  return row ?? null;
}

async function llmSaysOverview(c: Candidate, gameTitle: string): Promise<boolean> {
  if (!(await tryConsume("heavy"))) return false;
  try {
    const { data } = await groqJson<{ ok?: boolean }>(
      "heavy",
      [
        {
          role: "system",
          content:
            "Decide if a YouTube video is a spoiler-free gameplay overview of a specific game, suitable for someone " +
            "deciding whether to buy it (not a playthrough, story recap, ending, boss fight, mod showcase or a " +
            'different game). Respond with JSON {"ok": true|false}.',
        },
        {
          role: "user",
          content: `Game: ${gameTitle}\nTitle: ${c.title}\nChannel: ${c.channelTitle}\nLength: ${Math.round(c.durationSec / 60)} min\nDescription: ${c.description}`,
        },
      ],
      { maxTokens: 300, timeoutMs: 10000 },
    );
    return data.ok === true;
  } catch {
    return false;
  }
}

async function save(
  gameId: string,
  c: Candidate,
  kind: string,
  by: "rules" | "llm",
  score: number,
  risk: number,
  selected: boolean,
) {
  const [row] = await q<{ id: string }>(
    `INSERT INTO videos (game_id, youtube_id, kind, title, channel_title, duration_sec, spoiler_risk, classified_by,
                         quality_score, is_selected, is_embeddable, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10, now())
     ON CONFLICT (game_id, youtube_id) DO UPDATE SET quality_score = EXCLUDED.quality_score, checked_at = now()
     RETURNING id`,
    [gameId, c.youtubeId, kind, c.title, c.channelTitle, c.durationSec, risk, by, score, c.embeddable],
  );
  if (selected) {
    // Two requests can race to pick a video for the same game; keep whichever was selected first.
    await q(
      `UPDATE videos SET is_selected = true
       WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM videos WHERE game_id = $2 AND is_selected)`,
      [row.id, gameId],
    );
  }
  return row.id;
}

async function selectTrailer(game: GameRow): Promise<boolean> {
  const pick = pickTrailer(game.external_ids.igdb_videos ?? []);
  if (!pick) return false;
  const [c] = await videoDetails([pick.id]);
  if (!c?.embeddable) return false;
  await save(game.id, c, pick.kind, "rules", 5, 0.05, true);
  return true;
}

async function selectOverview(game: GameRow): Promise<boolean> {
  const ids = await searchVideoIds(`${game.title} gameplay overview`);
  const judged = (await videoDetails(ids))
    .map((c) => ({ c, v: judgeOverview(c, game) }))
    .filter((x) => !x.v.reject)
    .sort((a, b) => b.v.score - a.v.score);
  for (const { c, v } of judged.slice(0, 4)) {
    if (v.score >= ACCEPT) {
      await save(game.id, c, "gameplay_overview", "rules", v.score, v.spoilerRisk, true);
      return true;
    }
    if (v.score >= BORDERLINE && (await llmSaysOverview(c, game.title))) {
      await save(game.id, c, "gameplay_overview", "llm", v.score, v.spoilerRisk, true);
      return true;
    }
  }
  return false;
}

/**
 * Returns the cached video or selects one. Released games fall back to their IGDB trailer when no overview
 * qualifies or the YouTube budget is used up. Returns null when nothing suitable exists.
 */
export async function ensureVideo(gameId: string | number): Promise<SelectedVideo | null> {
  const cached = await getSelectedVideo(gameId);
  if (cached) return cached;
  const [game] = await q<GameRow>(
    `SELECT id, title, developer, publisher, release_status, external_ids FROM games WHERE id = $1`,
    [gameId],
  );
  if (!game) return null;
  try {
    if (game.release_status === "upcoming") await selectTrailer(game);
    else if (!(await selectOverview(game))) await selectTrailer(game);
  } catch (e) {
    if (!(e instanceof QuotaExhaustedError)) throw e;
    // Out of search quota: a trailer check costs 1 unit and may still fit; otherwise no video for now.
    await selectTrailer(game).catch(() => false);
  }
  return getSelectedVideo(gameId);
}
