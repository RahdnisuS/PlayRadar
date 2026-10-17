// Queues due wishlist alerts, then emails them. Run after every price refresh.
//   (no flag)   send to "instant" users
//   --digest    also send the daily digest, and on Mondays (UTC) the weekly one
//   --dry       print what would be queued / sent; writes nothing and sends nothing
//   --preview D with --dry, also save each email's HTML into directory D
import "../env";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { closeDb } from "../db";
import { queueAlerts } from "../../lib/alerts/queue";
import { sendQueuedAlerts, type Digest } from "../../lib/alerts/send";

const DRY = process.argv.includes("--dry");
const DIGEST = process.argv.includes("--digest");
const previewDir = process.argv.includes("--preview") ? process.argv[process.argv.indexOf("--preview") + 1] : null;

async function main() {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://play-radar-ten.vercel.app").replace(/\/$/, "");

  const queued = await queueAlerts({ dry: DRY });
  if (DRY) {
    console.log(`${queued.found.length} price alerts currently due (before dedupe):`);
    for (const a of queued.found) console.log(`  ${a.type} game ${a.gameId} listing ${a.listingId} ${a.country} (${a.dedupeKey})`);
  } else {
    console.log(`queued ${queued.price} new price alerts, ${queued.released} release alerts`);
  }

  const digests: Digest[] = ["instant"];
  if (DIGEST) {
    digests.push("daily");
    if (new Date().getUTCDay() === 1) digests.push("weekly");
  }
  if (previewDir) mkdirSync(previewDir, { recursive: true });
  let n = 0;
  const res = await sendQueuedAlerts(digests, {
    dry: DRY,
    siteUrl,
    preview: previewDir ? (_to, html) => writeFileSync(join(previewDir, `email-${++n}.html`), html) : undefined,
  });
  console.log(
    `${DRY ? "[dry] " : ""}${digests.join("+")}: ${res.emails} emails covering ${res.sent} alerts; ` +
      `${res.dropped} no longer valid, ${res.leftQueued} left queued, ${res.failed} failed`,
  );
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
