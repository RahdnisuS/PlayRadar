// Everything the game popup shows apart from prices (those come from lib/prices/details.ts).
import { q } from "../db";

export type GameDetails = {
  id: string;
  title: string;
  summary: string | null;
  cover_url: string | null;
  release_status: "released" | "upcoming" | "early_access";
  release_date: string | null;
  developer: string | null;
  publisher: string | null;
  avg_playtime_hrs: number | null;
  is_multiplayer: boolean | null;
  is_coop: boolean | null;
  genres: string[];
  themes: string[];
  moods: string[];
  modes: string[]; // mechanic tags such as "Single player"
  video_youtube_id: string | null;
};

export async function getGameDetails(id: string): Promise<GameDetails | null> {
  const [row] = await q<GameDetails>(
    `SELECT g.id, g.title, g.summary, g.cover_url, g.release_status, g.release_date::text, g.developer, g.publisher,
            g.avg_playtime_hrs::float AS avg_playtime_hrs, g.is_multiplayer, g.is_coop,
            COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.kind = 'genre'), '{}') AS genres,
            COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.kind = 'theme'), '{}') AS themes,
            COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.kind = 'mood'), '{}') AS moods,
            COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.kind = 'mechanic'), '{}') AS modes,
            (SELECT v.youtube_id FROM videos v WHERE v.game_id = g.id AND v.is_selected AND v.status = 'ok') AS video_youtube_id
     FROM games g
     LEFT JOIN game_tags gt ON gt.game_id = g.id
     LEFT JOIN tags t ON t.id = gt.tag_id
     WHERE g.id = $1
     GROUP BY g.id`,
    [id],
  );
  return row ? { ...row, id: String(row.id) } : null;
}
