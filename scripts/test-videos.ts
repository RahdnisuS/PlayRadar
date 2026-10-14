// Runs video selection on a few games and prints what was chosen (each released game costs ~101 YouTube units).
// Usage: npx tsx scripts/test-videos.ts [released=6] [upcoming=2]
import "./env";
import { q, closeDb } from "./db";
import { ensureVideo } from "../lib/video/select";

async function main() {
  const released = Number(process.argv[2] ?? 6);
  const upcoming = Number(process.argv[3] ?? 2);
  const games = await q<{ id: string; title: string; release_status: string }>(
    `(SELECT id, title, release_status FROM games WHERE release_status = 'released' ORDER BY random() LIMIT $1)
     UNION ALL
     (SELECT id, title, release_status FROM games WHERE release_status = 'upcoming' ORDER BY popularity DESC LIMIT $2)`,
    [released, upcoming],
  );
  for (const g of games) {
    const t = Date.now();
    const v = await ensureVideo(g.id);
    const [meta] = v
      ? await q<{ duration_sec: number; classified_by: string; quality_score: number }>(
          `SELECT duration_sec, classified_by, quality_score FROM videos WHERE id = $1`, [v.id])
      : [];
    console.log(
      `${g.release_status.padEnd(8)} ${g.title.slice(0, 32).padEnd(32)} -> ` +
        (v
          ? `${v.kind} "${v.title?.slice(0, 50)}" by ${v.channel} | ${Math.round((meta?.duration_sec ?? 0) / 60)}min | ${meta?.classified_by} score ${meta?.quality_score} | https://youtu.be/${v.youtubeId}`
          : "no video") + ` (${Date.now() - t}ms)`,
    );
  }
  const [usage] = await q(`SELECT calls FROM llm_usage_daily WHERE day = current_date AND scope_key = 'youtube:units'`);
  console.log(`YouTube units used today: ${usage?.calls ?? 0}`);
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
