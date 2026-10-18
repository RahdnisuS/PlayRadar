// Picks the 50-game video evaluation set and makes sure each game has a selected video, so the user can label
// them on /admin/videos. The set is a fixed pseudo-random sample of the 1,500 most popular games (42 released or
// early access, 8 upcoming), saved to lib/video/evalSet.json so it never shifts as the catalog changes.
// Each released game without a cached video costs ~101 YouTube units.
// Usage: npx tsx scripts/prepare-video-eval.ts [--reset]   (--reset picks a new sample)
import { existsSync, readFileSync, writeFileSync } from "fs";
import "./env";
import { q, closeDb } from "./db";
import { ensureVideo } from "../lib/video/select";

const FILE = "lib/video/evalSet.json";
const RELEASED = 42;
const UPCOMING = 8;

async function pickSample(): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `WITH pool AS (
       SELECT id, release_status FROM games WHERE popularity > 0 ORDER BY popularity DESC LIMIT 1500
     )
     (SELECT id FROM pool WHERE release_status <> 'upcoming' ORDER BY md5(id::text || 'video-eval-v1') LIMIT $1)
     UNION ALL
     (SELECT id FROM pool WHERE release_status = 'upcoming' ORDER BY md5(id::text || 'video-eval-v1') LIMIT $2)`,
    [RELEASED, UPCOMING],
  );
  return rows.map((r) => String(r.id));
}

async function main() {
  let ids: string[];
  if (existsSync(FILE) && !process.argv.includes("--reset")) {
    ids = JSON.parse(readFileSync(FILE, "utf8")).gameIds;
    console.log(`Using the existing set of ${ids.length} games from ${FILE}`);
  } else {
    ids = await pickSample();
    writeFileSync(FILE, JSON.stringify({ note: "Written by scripts/prepare-video-eval.ts", gameIds: ids }, null, 2) + "\n");
    console.log(`Picked ${ids.length} games, saved to ${FILE}`);
  }

  let missing = 0;
  for (const id of ids) {
    const [g] = await q<{ title: string; release_status: string }>(`SELECT title, release_status FROM games WHERE id = $1`, [id]);
    const v = await ensureVideo(id);
    if (!v) missing++;
    console.log(`${(g?.release_status ?? "?").padEnd(12)} ${(g?.title ?? id).slice(0, 40).padEnd(40)} -> ${v ? `${v.kind} https://youtu.be/${v.youtubeId}` : "no video"}`);
  }
  const [usage] = await q<{ calls: number }>(`SELECT calls FROM llm_usage_daily WHERE day = current_date AND scope_key = 'youtube:units'`);
  console.log(`${ids.length - missing}/${ids.length} games have a video. YouTube units used today: ${usage?.calls ?? 0}`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
