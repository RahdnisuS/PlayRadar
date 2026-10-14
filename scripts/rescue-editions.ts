// Seed-time repair: when a game's Steam listing isn't purchasable (delisted original), find the edition Steam
// actually sells (e.g. "GTA V Enhanced", "Arkham City - Game of the Year Edition") via Steam's store search and
// repoint the listing to it. Only names that are the same title plus edition words are accepted, so DLC never matches.
// Usage: npx tsx scripts/rescue-editions.ts [--dry]
import "./env";
import { q, closeDb } from "./db";
import { refreshPrices } from "../lib/prices/service";

const DRY = process.argv.includes("--dry");
const EDITION_WORDS = new Set([
  "edition", "enhanced", "definitive", "goty", "game", "of", "the", "year", "remastered", "remaster", "legendary",
  "special", "complete", "anniversary", "ultimate", "deluxe", "directors", "director", "cut", "redux", "hd", "classic",
  "gold", "premium", "standard", "collection", "final", "royal", "golden", "reloaded", "extended", "enhanced", "version",
]);

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[™®©]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

type SearchItem = { id: number; name: string; type: string; price?: { final: number } };

async function steamSearch(term: string): Promise<SearchItem[]> {
  const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=in&l=english`);
  if (!r.ok) return [];
  return (await r.json()).items ?? [];
}

/** Best purchasable edition of `title`: fewest extra words, then cheapest. */
function pickEdition(title: string, items: SearchItem[], currentAppId: string): SearchItem | null {
  const base = norm(title);
  const ok = items.filter((it) => {
    if (it.type !== "app" || String(it.id) === currentAppId || !it.price) return false;
    const n = norm(it.name);
    if (!n.startsWith(base)) return false;
    const extra = n.slice(base.length).trim().split(" ").filter(Boolean);
    return extra.length > 0 && extra.every((w) => EDITION_WORDS.has(w));
  });
  ok.sort((a, b) => norm(a.name).length - norm(b.name).length || (a.price?.final ?? 0) - (b.price?.final ?? 0));
  return ok[0] ?? null;
}

async function main() {
  const broken = await q<{ game_id: string; title: string; listing_id: string; appid: string }>(
    `SELECT g.id AS game_id, g.title, sl.id AS listing_id, sl.store_app_id AS appid
     FROM games g JOIN store_listings sl ON sl.game_id = g.id JOIN stores s ON s.id = sl.store_id AND s.code = 'steam'
     WHERE g.release_status <> 'upcoming'
       AND NOT EXISTS (SELECT 1 FROM price_summary ps WHERE ps.listing_id = sl.id)
     ORDER BY g.popularity DESC`,
  );
  console.log(`${broken.length} Steam listings without a price`);
  const fixed: string[] = [];
  for (const b of broken) {
    const pick = pickEdition(b.title, await steamSearch(b.title), b.appid);
    await new Promise((r) => setTimeout(r, 400));
    if (!pick) continue;
    const appid = String(pick.id);
    const taken = await q(`SELECT 1 FROM store_listings WHERE store_id = 1 AND store_app_id = $1`, [appid]);
    if (taken.length) continue;
    console.log(`  ${b.title}: ${b.appid} -> ${appid} "${pick.name}"`);
    if (DRY) continue;
    await q(
      `UPDATE store_listings SET store_app_id = $2, store_url = $3, steam_app_link = $4 WHERE id = $1`,
      [b.listing_id, appid, `https://store.steampowered.com/app/${appid}/`, `steam://store/${appid}`],
    );
    // Point the game at the edition's IsThereAnyDeal entry if it has one and nobody else uses it.
    const r = await fetch(`https://api.isthereanydeal.com/lookup/id/shop/61/v1?key=${process.env.ITAD_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([`app/${appid}`]),
    });
    const itadId = r.ok ? (await r.json())[`app/${appid}`] : null;
    if (itadId) {
      await q(
        `UPDATE games SET itad_id = $2 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM games WHERE itad_id = $2 AND id <> $1)`,
        [b.game_id, itadId],
      );
    }
    fixed.push(b.game_id);
  }
  if (fixed.length) {
    await refreshPrices(fixed, "IN", { backfill: false });
    console.log(`repointed ${fixed.length} games and refreshed their IN prices`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
