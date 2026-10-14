// Offline unit checks for the video title rules (no API calls).
import { judgeOverview, mentionsGame } from "../lib/video/rules";

const cases: [string, string, boolean][] = [
  ["Crime Scene Evidence Cleaner Gameplay (Android, iOS)", "Crime Scene Cleaner", false],
  ["Crime Scene Cleaner - Gameplay Overview", "Crime Scene Cleaner", true],
  ["Hellblade: Senua's Sacrifice Review", "Hellblade: Senua's Sacrifice", true],
  ["Final Fantasy Tactics Gameplay", "Final Fantasy Tactics: The Ivalice Chronicles", true],
  ["Portal 2 Gameplay", "Portal", false],
  ["The Witcher 3 Wild Hunt - 10 Minutes of Gameplay", "The Witcher 3: Wild Hunt", true],
];
let fail = 0;
for (const [video, game, want] of cases) {
  const got = mentionsGame(video, game);
  if (got !== want) fail++;
  console.log(`${got === want ? "ok  " : "FAIL"} mentionsGame(${JSON.stringify(video)}, ${JSON.stringify(game)}) = ${got}`);
}
const g = { title: "Elden Ring", developer: "FromSoftware", publisher: "Bandai Namco" };
const base = { youtubeId: "x", channelTitle: "IGN", description: "", durationSec: 600, embeddable: true };
for (const [title, wantReject] of [
  ["Elden Ring Walkthrough Part 1", true], ["Elden Ring - Ending", true], ["Elden Ring All Bosses", true],
  ["Elden Ring Gameplay Overview", false], ["Elden Ring Mobile Gameplay", true],
] as const) {
  const v = judgeOverview({ ...base, title }, g);
  const ok = !!v.reject === wantReject;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${title} -> ${v.reject ?? `score ${v.score}`}`);
}
process.exit(fail ? 1 : 0);
