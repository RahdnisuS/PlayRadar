// Debug: run the Steam storefront fallback on currently unpriced Steam listings.
import "./env";
import { q, closeDb } from "./db";
import { steamStorePrices } from "../lib/prices/steamStore";

async function main() {
  const rows = await q<{ appid: string; title: string }>(
    `SELECT sl.store_app_id AS appid, g.title FROM store_listings sl JOIN games g ON g.id = sl.game_id
     WHERE sl.store_id = 1 AND g.release_status <> 'upcoming'
       AND NOT EXISTS (SELECT 1 FROM price_summary ps WHERE ps.listing_id = sl.id) LIMIT 60`);
  const res = await steamStorePrices(rows.map((r) => r.appid), "IN");
  console.log(`${res.size}/${rows.length} priced by Steam storefront`);
  for (const r of rows.slice(0, 8)) console.log(r.title, r.appid, res.get(r.appid));
  const raw = await fetch(`https://store.steampowered.com/api/appdetails?appids=${rows.slice(0, 50).map((r) => r.appid).join(",")}&cc=in&filters=price_overview`);
  console.log("raw batch status:", raw.status, (await raw.text()).slice(0, 200));
  await closeDb();
}
main();
