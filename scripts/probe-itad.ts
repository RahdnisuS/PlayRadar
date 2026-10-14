// Day-1 check: does IsThereAnyDeal return Steam (61) and Epic (16) prices for each of our regions?
// Usage: npx tsx scripts/probe-itad.ts
import "./env";

const KEY = process.env.ITAD_API_KEY;
if (!KEY) throw new Error("ITAD_API_KEY missing");
const BASE = "https://api.isthereanydeal.com";

// Games known to be on both Steam and Epic.
const STEAM_APPIDS = [1145360 /* Hades */, 1091500 /* Cyberpunk 2077 */, 1174180 /* RDR2 */];
const COUNTRIES = ["IN", "US", "GB", "DE"];

async function lookup(appid: number): Promise<{ id: string; title: string } | null> {
  const r = await fetch(`${BASE}/games/lookup/v1?key=${KEY}&appid=${appid}`);
  const j = await r.json();
  return j.found ? { id: j.game.id, title: j.game.title } : null;
}

async function main() {
  const games = (await Promise.all(STEAM_APPIDS.map(lookup))).filter(Boolean) as { id: string; title: string }[];
  console.log("lookup:", games);
  for (const country of COUNTRIES) {
    const r = await fetch(`${BASE}/games/prices/v3?key=${KEY}&country=${country}&shops=61,16`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(games.map((g) => g.id)),
    });
    console.log(`\n== ${country} (HTTP ${r.status}, rate remaining: ${r.headers.get("x-ratelimit-remaining") ?? "?"})`);
    const data = await r.json();
    for (const entry of data) {
      const title = games.find((g) => g.id === entry.id)?.title;
      for (const d of entry.deals ?? []) {
        console.log(`  ${title} | ${d.shop.name} | ${d.price.amount} ${d.price.currency} (regular ${d.regular.amount}, -${d.cut}%) | low ${d.historyLow?.amount ?? "-"} | expiry ${d.expiry ?? "-"}`);
      }
      if (!entry.deals?.length) console.log(`  ${title} | no deals`);
    }
  }
}
main();
