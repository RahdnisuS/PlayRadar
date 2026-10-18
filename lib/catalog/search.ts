// Title search for the header search bar. The catalog is ~2,000 games, so a scan with word-prefix matching is
// fast enough without an index: every typed word must start a word in the title ("witch 3" -> "The Witcher 3").
// Common abbreviations expand to full titles, and digits also match roman numerals ("baldur 3" -> "Baldur's Gate III").
import { q } from "../db";
import { ALIASES } from "./aliases";

export type SearchHit = {
  id: string;
  title: string;
  cover_url: string | null;
  release_status: string;
  release_date: string | null;
  min_price_cents: number | null;
  currency: string | null;
};

const ROMAN = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** One regex per typed word; words are alphanumeric after norm(), so they are safe inside a pattern. */
function wordPattern(w: string): string {
  const alts = [w];
  if (ALIASES[w]) alts.push(ALIASES[w]);
  const n = Number(w);
  if (Number.isInteger(n) && n > 0 && n < ROMAN.length) alts.push(`${ROMAN[n]} `);
  return ` (?:${alts.join("|")})`;
}

export async function searchGames(query: string, country: string, limit = 8): Promise<SearchHit[]> {
  const words = norm(query).split(" ").filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  return q<SearchHit>(
    `WITH g AS (
       SELECT id, title, cover_url, release_status, release_date, popularity,
              ' ' || trim(regexp_replace(lower(title), '[^[:alnum:]]+', ' ', 'g')) || ' ' AS t
       FROM games
     )
     SELECT g.id, g.title, g.cover_url, g.release_status, g.release_date::text,
            p.min_cents AS min_price_cents, p.currency
     FROM g
     LEFT JOIN LATERAL (
       SELECT ps.current_cents AS min_cents,
              (SELECT currency FROM price_snapshots s WHERE s.listing_id = sl.id AND s.country_code = $3
               ORDER BY captured_at DESC LIMIT 1) AS currency
       FROM store_listings sl JOIN price_summary ps ON ps.listing_id = sl.id AND ps.country_code = $3
       WHERE sl.game_id = g.id ORDER BY ps.current_cents LIMIT 1
     ) p ON true
     WHERE (SELECT bool_and(g.t ~ w) FROM unnest($1::text[]) w)
     ORDER BY (g.t = ' ' || $2 || ' ') DESC, (g.t LIKE ' ' || $2 || '%') DESC, g.popularity DESC
     LIMIT ${Number(limit)}`,
    [words.map(wordPattern), words.join(" "), country],
  );
}
