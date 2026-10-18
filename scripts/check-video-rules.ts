// Offline unit checks for the video title rules (no API calls).
import { judgeOverview, mentionsGame, trailerReject } from "../lib/video/rules";

const cases: [string, string, boolean][] = [
  ["Crime Scene Evidence Cleaner Gameplay (Android, iOS)", "Crime Scene Cleaner", false],
  ["Crime Scene Cleaner - Gameplay Overview", "Crime Scene Cleaner", true],
  ["Hellblade: Senua's Sacrifice Review", "Hellblade: Senua's Sacrifice", true],
  ["Final Fantasy Tactics Gameplay", "Final Fantasy Tactics: The Ivalice Chronicles", true],
  ["Portal 2 Gameplay", "Portal", false],
  ["The Witcher 3 Wild Hunt - 10 Minutes of Gameplay", "The Witcher 3: Wild Hunt", true],
  ["GTA San Andreas - Gameplay Overview", "Grand Theft Auto: San Andreas", true],
  ["GTA 5 Gameplay", "Grand Theft Auto: San Andreas", false],
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
  ["I Studied Elden Ring Pro Gameplay for 100 Hours (Here's What I Learned)", true], ["Elden Ring Tournament Highlights", true],
  ["Elden Ring Tips and Tricks for Beginners", true], ["Elden Ring - Before You Buy", false], ["Elden Ring Review", false],
] as const) {
  const v = judgeOverview({ ...base, title }, g);
  const ok = !!v.reject === wantReject;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${title} -> ${v.reject ?? `score ${v.score}`}`);
}

// Cases from the 50-video hand-labelled eval (2026-10-18): real titles, labelled wrong (reject) or right (keep).
const overview = { ...base, channelTitle: "Some Channel", durationSec: 750 };
for (const [title, game, wantReject] of [
  ["Caves of Qud - (Nintendo Switch 1) - Framerate & Gameplay - 4K", "Caves of Qud", true],
  ["Claudio Overview - Tekken 7 [4K]", "Tekken 7", true],
  ["100 Ninja Cats Gameplay (Steam New Releases)", "100 Ninja Cats", true],
  ["Gestalt Steam & Cinder - UM RPG METROIDVANIA DIFERENCIADO! É UM BOM JOGO OU DECEPÇÃO? Análise/Review", "Gestalt: Steam & Cinder", true],
  ["Pax Dei   The best solo farm for massive Gold / XP / Enchantments", "Pax Dei", true],
  ["Ni no Kuni II: REVENANT KINGDOM - PS4 Gameplay Demo | E3 2017", "Ni no Kuni II: Revenant Kingdom", false],
  ["Dawn of Discovery (Anno 1404) ... (Wii) Gameplay", "Dawn of Discovery", false],
  ["The Witcher 3: Wild Hunt - Songs of the Past Gameplay Overview", "The Witcher 3: Wild Hunt", false],
  ["Farming Simulator 25 Gameplay Overview", "Farming Simulator 25", false],
  ["GTA San Andreas Story Summary in हिंदी", "Grand Theft Auto: San Andreas", true],
  ["GTA San Andreas - Intro & Mission #1 - Big Smoke, Sweet & Kendl (HD)", "Grand Theft Auto: San Andreas", true],
  ["Pokémon Legends: Arceus Gameplay Overview", "Pokémon Legends: Arceus", false],
] as const) {
  const v = judgeOverview({ ...overview, title }, { title: game, developer: null, publisher: null });
  const ok = !!v.reject === wantReject;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${title} -> ${v.reject ?? `score ${v.score}`}`);
}
const trailer = { ...base, channelTitle: "Some Channel", durationSec: 120 };
for (const [title, game, dur, wantReject] of [
  ["Pony Island ll playthrough ll no commentary gameplay", "Pony Island", 6639, true],
  ["Rivals 2 Gameplay - BioBirb (Wrastor) vs Trace (Ranno) Riptide 2023 Demo", "Rivals of Aether II", 187, true],
  ["Rivals 2 - Maypul Moveset Breakdown", "Rivals of Aether II", 300, true],
  ["GTA San Andreas - Full Game Walkthrough in 4K", "Grand Theft Auto: San Andreas", 30000, true],
  ["Invincible VS | Official Cinematic Gameplay Reveal Trailer", "Invincible Vs.", 150, false],
  ["Hollow Knight - Gameplay Trailer", "Hollow Knight", 20 * 60, true],
  ["国产抗日FPS《烽火十四》先导预告 |枕戈待旦，除凶去害", "Fourteen Years of Flames", 90, false],
] as const) {
  const r = trailerReject({ ...trailer, title, durationSec: dur }, game);
  const ok = !!r === wantReject;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} trailer ${title} -> ${r ?? "kept"}`);
}
process.exit(fail ? 1 : 0);
