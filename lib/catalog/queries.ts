import { q } from "../db";

export type GameCard = {
  id: string;
  slug: string;
  title: string;
  cover_url: string | null;
  release_status: "released" | "upcoming" | "early_access";
  release_date: string | null;
  tags: string[];
  min_price_cents: number | null;
  regular_cents: number | null;
  currency: string | null;
};

/** Game cards with the cheapest current price in a region (null when we have no price yet). */
export async function getGameCards(where: string, params: unknown[], country: string, limit: number): Promise<GameCard[]> {
  return q<GameCard>(
    `SELECT g.id, g.slug, g.title, g.cover_url, g.release_status, g.release_date::text,
            COALESCE((SELECT array_agg(t.name ORDER BY t.kind, t.name) FROM game_tags gt JOIN tags t ON t.id = gt.tag_id
                      WHERE gt.game_id = g.id AND t.kind IN ('genre','mood')), '{}') AS tags,
            p.current_cents AS min_price_cents, p.regular_cents, p.currency
     FROM games g
     LEFT JOIN LATERAL (
       SELECT ps.current_cents, s.regular_cents, s.currency
       FROM store_listings sl
       JOIN price_summary ps ON ps.listing_id = sl.id AND ps.country_code = $1
       LEFT JOIN LATERAL (SELECT regular_cents, currency FROM price_snapshots
                          WHERE listing_id = sl.id AND country_code = $1 ORDER BY captured_at DESC LIMIT 1) s ON true
       WHERE sl.game_id = g.id ORDER BY ps.current_cents LIMIT 1
     ) p ON true
     WHERE ${where}
     ORDER BY g.popularity DESC
     LIMIT ${Number(limit)}`,
    [country, ...params],
  );
}
