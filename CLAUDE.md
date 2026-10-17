# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PlayRadar is a zero-budget resume project. It's a conversational PC-game discovery and deal-tracking site covering **Steam and Epic only**; purchases never happen on our site. Users chat, and an LLM turns each message into structured filters. Those filters plus pgvector similarity return the top 5 games from **our own DB only**, so the model never invents games. Each result shows a spoiler-free YouTube video, a regional price comparison and wishlist alerts. The alert emails show the actual price, which is the key differentiator over Steam and Epic notifications.

Everything must stay within free tiers. Each external dependency sits behind an interface and has a non-LLM / non-API fallback. The user wants to be **asked before any major decision** (new service, schema redesign, changing a provider).

## Commands

```bash
npm run dev            # Next.js dev server
npm run build          # production build
npm run lint           # ESLint
npx tsc --noEmit       # typecheck (CI runs lint + this)

# Offline checks (no API calls, exit 1 on failure) - the closest thing to unit tests
npx tsx scripts/check-fallback.ts       # keyword fallback parser cases
npx tsx scripts/check-video-rules.ts    # video title / spoiler / sequel rules
npx tsx scripts/check-hint.ts           # wait-or-buy hint rules
npx tsx scripts/check-alerts.ts         # wishlist alert episode rules
npx tsx scripts/check-epic-free.ts      # Epic giveaway feed parsing + free-game email wording

# Offline scripts / jobs (tsx, load .env.local via scripts/env.ts)
npx tsx scripts/seed-igdb.ts [--released 1700] [--upcoming 300]   # catalog seed + ITAD id resolution (re-runnable, upserts)
npx tsx scripts/jobs/refresh-catalog-prices.ts [--country XX] [--report-unsold]  # prices for whole catalog in all 4 regions; report lists unpriced games
npx tsx scripts/jobs/poll-wishlist-prices.ts                      # prices for wishlisted games in each user's region (every 4h)
npx tsx scripts/jobs/refresh-releases.ts [--dry]                  # IGDB status/dates for upcoming + early-access games (daily)
npx tsx scripts/jobs/alerts.ts [--digest] [--dry [--preview DIR]] # queue + email wishlist alerts; --digest adds daily (+weekly on Mondays)
npx tsx scripts/jobs/epic-free.ts [--dry]                         # Epic giveaways -> catalog (adds missing games) + free_promotions + queue free_to_claim
npx tsx scripts/rescue-editions.ts [--dry]                        # repoint delisted Steam originals to the edition Steam sells
npx tsx scripts/dedupe-editions.ts [--dry]                        # delete unpriced games whose sellable edition is already in catalog
npx tsx scripts/add-epic-listings.ts [--dry]                      # add Epic listings IGDB missed (via ITAD deal links); additive
npx tsx scripts/enrich-igdb.ts [--dry]                            # IGDB keyword sub-genre tags + early_access_date; additive
npx tsx scripts/mood-tags.ts [--limit N] [--redo]                 # LLM mood tags for games lacking them; --redo re-tags mood_v<2 games
npx tsx scripts/embed-catalog.ts [--all]                          # gte-small embeddings for games lacking them
npx tsx scripts/probe-itad.ts                                     # sanity-check ITAD Steam/Epic prices per region
npx tsx scripts/check-embed.ts                                    # edge-function vs local embedding parity (cosine should be 1.0)

# Database / edge function (Supabase CLI via npx; source .env.local first)
npx supabase db push --db-url "$DATABASE_URL"                     # apply supabase/migrations/*
npx supabase functions deploy embed --no-verify-jwt --project-ref <ref> --use-api
```

Run seed scripts in this order: seed-igdb, refresh-catalog-prices, rescue-editions, dedupe-editions, add-epic-listings, mood-tags, embed-catalog. Embeddings include tag text, so mood tags must exist first. seed-igdb already does what enrich-igdb does; enrich-igdb is for games seeded before 2026-10-15.

**Tags.** Genres/themes/modes come from IGDB. Sub-genres players search for (Soulslike, Metroidvania, Roguelike, Action RPG, Deckbuilder…) come from a curated IGDB-keyword map in `lib/igdb/enrich.ts` and are stored as kind `genre`; "top-down"/"isometric" keywords map to `Bird view / Isometric`. Moods are LLM-generated from title, genres, keywords and a short summary. Mood redo v2 (with keywords) ran for the top 1,000 games on 2026-10-15; run `mood-tags.ts --redo` again to finish the rest, then `embed-catalog.ts --all`. Raw keywords are kept in `games.external_ids.igdb_keywords`. `games.early_access_date` is the PC early-access start when it is ≥ 60 days before the full release (IGDB's `first_release_date` is the full release). `scripts/inspect-igdb.ts "<title>"`, `check-llm.ts` and `check-steam-fallback.ts` are debugging helpers. `scripts/test-videos.ts [released] [upcoming]` runs real video selection, and costs about 101 YouTube units per released game.

To test the non-LLM path end to end, start a second dev server with a broken key: `GROQ_API_KEY=invalid npx next dev -p 3101`. On Windows, bash heredocs containing apostrophes have failed in this environment, so write files with the Write tool.

**Catalog policy (user decision):** games that neither price source can price, often because of region locks, **stay in the catalog** and show "Price unavailable". Only delete a game when it duplicates a sellable edition that is already in the catalog. Always run destructive catalog scripts with `--dry` first and show the user the list.

## Architecture

**Data access.** Server code talks to Postgres directly with `pg` through `lib/db.ts` (`q`, `tx`), not through supabase-js. On Vercel it rewrites `DATABASE_URL` from the session pooler (:5432) to the transaction pooler (:6543), with one connection per instance. `scripts/db.ts` re-exports the same module after loading `.env.local`. supabase-js is only for auth. RLS is enabled on every table with no policies, so only the server can read or write. The SQL functions are revoked from `anon` and `authenticated`.

**Schema.** `schema.sql` is the user's original design; it's copied unchanged as migration `..._base.sql`. All changes go in new migrations, never edits to the base file. Key additions are in `..._app.sql`:
- `match_games(query_emb, filters jsonb, country, user_id, limit)` is the single retrieval entry point. It applies hard SQL filters (tags_any / tags_exclude, coop, multiplayer, single_player, max_price_cents against `price_summary` in the user's region, playtime, release_status, exclude_ids) and excludes `user_excluded_games`. It ranks by `0.6*vector sim + 0.3*tag overlap + 0.03*user tag affinity + 0.05*popularity`.
- `try_consume_llm(scopes[], caps[], cost)` atomically enforces the daily LLM caps in `llm_usage_daily`.
- `try_consume_email(cap)` enforces the daily email cap.
- `hit_rate_limit(key, max, window_s)` is a fixed-window rate limiter; there's no Redis.
- `public.users` mirrors `auth.users` via a trigger.

**Embeddings.** The model is `gte-small` (384-dim) on both sides, and both sides must stay the same model:
- Catalog: offline via `@huggingface/transformers` with `Supabase/gte-small`.
- Queries: the Supabase Edge Function `supabase/functions/embed`, which uses the built-in `Supabase.ai.Session("gte-small")` and is authenticated with `EMBED_SECRET`.

`games.embedding_model` records which model produced each vector. The edge function is excluded from the Next.js tsconfig because it's Deno code.

**LLM** (`lib/llm/groq.ts`). Groq's free tier is **per model** (about 1000 requests/day, 8K tokens/min, about 200K tokens/day each), so jobs are split by role to multiply the quota:
- `filters` → `openai/gpt-oss-20b`
- `explain` → `qwen/qwen3.8-27b`
- `heavy` → `openai/gpt-oss-120b`, for seed-time mood tags and borderline video classification

These are reasoning models whose reasoning tokens count against the quota, so prompts stay compact and `reasoning_effort` is set low or none. Errors throw `LlmUnavailableError`, and callers must fall back to the non-LLM path (keyword parser + embedding search + templated reasons). Groq no longer serves Llama chat models on this account.

**Chat turn** (`lib/chat/handleMessage.ts`, `POST /api/chat`):
1. Rate-limit by IP and by identity. Identity (`lib/auth/identity.ts`) is a Supabase user or a guest, the guest identified by an HMAC-signed `pr_guest` cookie.
2. Check the `chat_cache` exact hash (normalized text + previous filters + region).
3. On first turns only, check for a similar-query hit (query embedding cosine ≥ 0.95).
4. Run `tryConsume("filters", who, ip)`, which applies the per-model global cap plus the guest 10 / user 30 / IP 40 daily turn caps. Then do LLM extraction, falling back to `parseFallback`.
5. `sanitize()` drops tags that aren't in the vocabulary, plus any `exclude_ids` from the LLM. `withDefaults()` restricts results to released and early-access games unless the user asks for upcoming ones.
6. `retrieve()` relaxes filters stepwise (playtime → tags → player mode; never price) when there are fewer than 5 hits.
7. Write the reasons: cached ones, then one `explain` LLM call, then `templateReason`.
8. Cache the result (LLM turns only), then persist `chat_messages` and `recommendations`.

Follow-up turns merge into the previous turn's `extracted_filters`. Body `{similarTo, sessionId}` runs `handleSimilar` instead: it searches around that game's own embedding and keeps the session's hard constraints. "Not for me" (`/api/events`) excludes the game for the rest of the session. For signed-in users it also writes `user_excluded_games` and adjusts `user_tag_affinity` (`lib/feedback.ts`). Events are only accepted for recommendations belonging to the caller's own session.

**Video** (`lib/video/`). `ensureVideo()` returns the cached `videos.is_selected` row or selects one, lazily, when the user clicks Watch. It must never select eagerly for all 5 results, because of the YouTube quota.
- Upcoming games use an IGDB trailer, at 1 unit for the embeddability check.
- Released games use `search.list` with "<title> gameplay overview" and `videoDuration=medium`, then `videos.list`, judged by `rules.ts`:
  - hard-reject walkthrough, ending, boss, part N, mobile and similar titles, plus off-format ones (personal challenges like "I played X for 100 hours", pro/competitive play, tournaments, tips, montages);
  - the game title must appear as a contiguous phrase that isn't followed by a sequel number;
  - score for an 8–15 minute length, an official channel (matching developer or publisher) or the reputable allowlist, and good title words.
  - A score ≥ 6 is accepted by rules; 3–5 goes to a `heavy` LLM yes/no check.
- If no overview qualifies, use the IGDB trailer.
- YouTube units are counted in `llm_usage_daily` scope `youtube:units` (cap 9000).

`components/VideoPlayer.tsx` uses the IFrame API on youtube-nocookie. Ending the video or closing it (× in the bar above the video) triggers "Did that look good?" in `ResultCard.tsx`.

**Game popup and search.** Clicking a result card (cover or title), a shelf card or a search suggestion opens `GameDialog.tsx` (`GET /api/games/[id]`, `lib/catalog/details.ts`): description, genres/themes/mood/modes, a video (no autoplay) and a "Where to buy" section (`PricePanel.tsx`, shared with the Buy popup `BuyDialog.tsx`). Opening the popup selects a video for that one game, like clicking Watch, so uncached games cost YouTube quota. The header search (`GameSearch.tsx`, `GET /api/search`, `lib/catalog/search.ts`) matches every typed word as a word prefix of the title, expands abbreviations (gta, cod, bg3…) and matches digits to roman numerals. It has no typo tolerance (that would need pg_trgm).

**Prices** (`lib/prices/`). `PriceProvider` is the interface and `itad.ts` (IsThereAnyDeal) the primary implementation. ITAD has no Steam price at all for about 6% of games that are on sale (e.g. Arma 3, Skyrim), so `service.ts` fills those gaps from Steam's public storefront API (`steamStore.ts`: batched `appdetails?filters=price_overview`, no key, regional via `cc`, free-to-play stored as price 0). Fallback prices have no history and no sale end date. Shop ids are Steam 61 and Epic 16; prices/v3 takes 200 ids per call, and amounts use `amountInt` minor units. Prices are stored in native currency per region, never converted. The regions are IN (default), US, GB and DE (standing in for the EU). `service.ts` rules:
- Write a `price_snapshots` row only when the price changes.
- `price_summary` holds the current price, the per-store all-time low (`storeLow` from ITAD) and `sale_count_12m` (the number of discount starts in the last 12 months).
- `price_fetch_state` drives a 6h on-demand TTL.
- The 12-month history is backfilled **lazily**, per listing and country, the first time it's needed (Buy popup or wishlist). This is tracked by `price_summary.history_backfilled_at`.
- The daily catalog refresh covers all four regions (user decision, so budget filters work everywhere) and passes `backfill: false`. `ensureFreshPrices` therefore also refreshes when a priced listing still lacks its backfill.
- ITAD `history/v2` rejects fractional seconds in `since`.
- `lib/prices/details.ts` builds the Buy popup data (`GET /api/games/[id]/prices`). History coverage counts as 12 months once backfilled. `lib/prices/hint.ts` is the wait-or-buy rule; it needs ≥ 6 months of coverage.
- ITAD doesn't list free Epic games (e.g. Fortnite), and there's no Epic fallback, so they show "Price unavailable".
- IGDB misses many Epic listings; `add-epic-listings.ts` finds them through ITAD Epic deals, whose itad.link URL redirects to the Epic page (the slug comes from the redirect; Epic itself answers 403 to scripts).
- The price chart uses literal hex colours: SVG presentation attributes don't resolve CSS `var()` reliably.

**Catalog** (`lib/igdb/client.ts`, `scripts/seed-igdb.ts`). IGDB is throttled to about 3 requests per second. The seed takes:
- ~70% all-time most-rated PC games,
- ~30% most-rated from the last 3 years,
- the top 300 of Steam's "most wishlisted upcoming" (IGDB popularity type 10).

All of them must have a Steam or Epic external id. `resolveStores()` handles games with several Steam apps: it picks the ITAD product that currently has a price, then the highest appid, and gives duplicate ITAD products to the more popular IGDB entry. IGDB often points a base game at its delisted original (GTA V → appid 271590), while the sellable re-release is a separate IGDB entry typed as a bundle or expanded game. `rescue-editions.ts` fixes this with Steam store search, using `lib/catalog/editions.ts` to accept only "same title + edition words" matches. IGDB trailer ids are stored in `games.external_ids.igdb_videos` for later video selection, which saves YouTube quota. Playtime uses IGDB's `hastily` (main story) time-to-beat. Epic listings use the slug from the store URL.

**Email** (set up 2026-10-15). Brevo free plan (300/day), no domain, one verified single sender (`EMAIL_FROM`, name `EMAIL_FROM_NAME`).
- Alerts and digests go through the Brevo transactional API (`POST https://api.brevo.com/v3/smtp/email`, header `api-key: BREVO_API_KEY`, which starts with `xkeysib-`).
- Supabase auth emails go through Brevo SMTP (`smtp-relay.brevo.com:587`, login `BREVO_SMTP_LOGIN`, password `BREVO_SMTP_KEY`, which starts with `xsmtpsib`). This is configured in Supabase → Authentication → Emails → SMTP Settings; the `.env.local` copies are only for testing.
- Brevo's "block unknown IP addresses" is **off** for both API and SMTP keys: Vercel, GitHub Actions and Supabase use changing IPs. A 401 with "unrecognised IP address" means it was switched back on.
- Supabase URL Configuration: Site URL `https://play-radar-ten.vercel.app`; redirect URLs are that `/**` plus `http://localhost:3000/**` and `http://localhost:3100/**`.
- Supabase email templates are still the defaults. Replace them with PlayRadar templates (no postal address) once the login page exists.
- Test sends via both routes and a real Supabase magic link reached the inbox, not spam. The user's own auth account now exists, created by that test.

**Scheduling.** Vercel Hobby cron only runs daily, so recurring jobs (price polling, digests, the Epic free-games check, catalog refresh) are planned as GitHub Actions running `scripts/jobs/*`. The repo is public, so Actions minutes are unlimited. Vercel functions are pinned to `bom1` (Mumbai) to sit next to the Supabase DB.

## Status and roadmap

The work follows a 14-day plan, and the live site is https://play-radar-ten.vercel.app. It deploys automatically on every push to `main`, and its env vars are set in the Vercel dashboard.

| Days | Scope | State |
|---|---|---|
| 1–2 | Setup, schema, seed, deployed skeleton | Done |
| 3–5 | Chat, filters, retrieval, caps, cache, fallback | Done |
| 6–7 | Video selection and spoiler filtering | Done. No scheduled backfill or re-check job yet |
| 8–9 | Region dropdown (header, `pr_region` cookie via `POST /api/region`; the home page renders per request), Buy popup (`BuyDialog.tsx`) comparing Steam and Epic cheapest-first, all-time-low badge, Recharts 3 history chart (lazy-loaded), wait-or-buy hint | Done |
| 10–11 | Supabase magic-link auth via Brevo SMTP, wishlist (target price + any-sale / ATL / release toggles), alert emails with deduplication and a daily cap, instant/daily/weekly/off digests, GitHub Actions jobs (`prices.yml` every 4h, `daily.yml`, `digests.yml`) | Done 2026-10-17 (first scheduled runs still to be watched). See **Next session** below |
| 12 | Epic free-games alerts (`epic-free.yml`, Epic `freeGamesPromotions` feed). The feedback loop already exists | Done 2026-10-17. See **Epic free games** below |
| 13 | 50-game hand-labelled video set (`video_eval_labels`), `/metrics` page + `sql/report.sql` (CTR, LLM vs fallback, cache hits, video accuracy), responsive polish, fuller legal pages | Not started |
| 14 | Buffer, README with screenshots and results | Not started |

Vercel now has `BREVO_API_KEY` (Sensitive, Production only) and `NEXT_PUBLIC_SITE_URL=https://play-radar-ten.vercel.app` (plain Config; a `NEXT_PUBLIC_` variable can't be Sensitive).

### Next session (stopped 2026-10-17, end of Day 11; resume with item 1 of "Still to do")
**Login + wishlist (done and pushed 2026-10-17):**
- Auth: `middleware.ts` refreshes the Supabase session only when an `sb-` cookie exists. `POST /api/auth/login` `{email, next}` sends the magic link (5/IP/h, 3/email/h, 80/day global, since auth shares Brevo's 300/day). `GET /auth/confirm` verifies `token_hash`, sets `users.email_verified`, moves the guest's `chat_sessions` to the user, copies a valid `pr_region` cookie into `users.country_code` (or, with no cookie, sets the cookie from the account). Failures redirect to `/?signin=expired|invalid`, which `AuthButton` turns into a message. `safeNext()` prevents open redirects. `POST /api/auth/logout`, `GET /api/me`.
- Supabase **Magic Link** and **Confirm signup** templates now link to `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email` with PlayRadar wording, no postal address.
- `lib/wishlist.ts` (max 200 items per user). `GET /api/wishlist`; `GET/PUT/DELETE /api/wishlist/[gameId]` (PUT target in major units → `toCents`, stored in the region's currency; `after()` runs `ensureFreshPrices` for the history backfill). `PATCH /api/account` for `email_digest` / `free_game_alerts`.
- UI: `AuthButton` (header), `SignInForm`, `WishlistButton` + `WishlistDialog` (in `GameDialog` and the result card's "Did that look good?" row; result cards log `wishlisted` and save with source `chat`), `/wishlist` page (`WishlistPage.tsx`) with items, edit and email preferences. `components/useMe.ts` shares one `/api/me` fetch; call `refreshMe()` after changes.
- A target set in another region's currency is kept as-is; the alerts job must compare it only against prices in `target_currency`.
- Testing sign-in without sending email: `supabase.auth.admin.generateLink({type:"magiclink", email})` with the service role key gives `properties.hashed_token`; open `/auth/confirm?token_hash=<it>&next=/wishlist` with a cookie jar.

**Alerts + digests (done 2026-10-17, `lib/alerts/`, `lib/email/brevo.ts`):**
- State-based, independent of who refreshed prices. `rules.ts` (pure, checked by `check-alerts.ts`): an alert's *episode* is the trailing run of snapshots where its condition holds (on sale / at or below `price_summary.lowest_cents` while on sale, needing the history backfill / at or below the target in `target_currency`). The dedupe key holds the episode's first snapshot id, and only episodes that started after `wishlist_items.added_at` alert (so no mail about a sale already running when the game was added). Released: `release_date` (or `early_access_date` for early access) between `added_at` and today.
- `queue.ts` inserts into `notifications` (snapshot_id = latest). `send.ts` re-checks each queued alert (sale ended / flag turned off / region changed / item removed → status `failed`, meaning dropped), groups one email per user per run (max 20 items), shows the latest price, `try_consume_email(200)`, then marks `sent`. Queued > 14 days or users paused/unverified → `failed`. Brevo 400 = permanent failure; other errors stay queued.
- `email.ts`: price-first subject and body, store button (https URL), footer with reason, manage link and unsubscribe; no postal address. Headers `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058) → `POST /api/unsubscribe?token=`. The footer link opens `/unsubscribe?token=` with one button (GET never unsubscribes, so link scanners can't). Unsubscribe sets `email_digest='off'`, `free_game_alerts=false`.
- Instant = one combined email per 4h check; daily digest 03:30 UTC (09:00 IST); weekly on Mondays.
- `refresh-releases.ts`: IGDB marks planned early-access launches as status EA, so early access needs a past EA date (or past release date); a release date ≥ 60 days after the EA start counts as the full release.
- GitHub Actions (all in concurrency group `db-jobs`): `prices.yml` (every 4h at :17: poll + alerts), `daily.yml` (21:30 UTC: catalog prices, releases, alerts; 300-min timeout because the runner is in the US and the DB in Mumbai, so watch the first run's duration), `digests.yml` (03:30 UTC), `epic-free.yml` (16:40 UTC). Repo secrets: `DATABASE_URL`, `ITAD_API_KEY`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `BREVO_API_KEY`, `EMAIL_FROM`, `GROQ_API_KEY` (epic-free only); the sender name and site URL are plain env in the workflow files.

**Verified 2026-10-17:**
- `prices.yml` run by hand (Actions → Wishlist prices → Run workflow): green. All workflows now use `actions/checkout@v5` and `actions/setup-node@v5` (Node 20 deprecation warning). The "ubuntu-latest moves to Ubuntu 26 from 2026-10-19" notice needs no action.
- A test alert email reached Gmail but landed in **Promotions** (Brevo log: delivered). The wishlist page tells Gmail users to drag one to Primary. Check Brevo delivery with `GET https://api.brevo.com/v3/smtp/statistics/events?email=<addr>` (header `api-key`).
- Brevo **click tracking is on**: links in our emails (store buttons, sign-in links) go through a Brevo redirect. Everything works; the user may switch it off in Brevo's transactional settings (offered, not done).
- `gh` (GitHub CLI) is not installed here, so the user starts workflows by hand from the Actions tab.

**Epic free games (done 2026-10-17):**
- `lib/epic/freeGames.ts` reads Epic's public `freeGamesPromotions` feed (country=US, no key). A giveaway is a promotional offer with `discountPercentage === 0` (Epic stores the multiplier, so 0 = 100% off); other offers are ordinary sales. Only BASE_GAME / BUNDLE / EDITION, no "Mystery Game" placeholders. Page slug from the `productHome` mapping (`urlSlug` is often a bare hex offer id). Current **and** upcoming giveaways go into `free_promotions`.
- **Catalog policy (user decision 2026-10-17): giveaway games missing from the catalog are added.** `lib/catalog/freeGames.ts` matches our Epic slug, then IGDB (`external_games` uid = Epic offer id, or the store URL; then exact title), then an existing igdb_id / itad_id / Steam appid (adds the Epic listing to that game). Otherwise it saves the IGDB game with `popularity 0` via `saveIgdbGame` (`lib/igdb/catalog.ts`, now shared with `seed-igdb.ts`), or, unknown to IGDB, a basic row from Epic's data (slug `epic-<slug>`, no tags). New games are priced in all 4 regions right away. First run added Sker Ritual, Bad Cheese, Agent A, Home (ids 2001-2004).
- `queueFreeGameAlerts()` (`lib/alerts/queue.ts`): one `free_to_claim` per running giveaway (ends > now + 2h) per verified user with `free_game_alerts`, dedupe `free:<promo_id>`. **Independent of `email_digest`**: sent on every alerts run (a giveaway lasts a week), even for digest `off`; dropped when the giveaway ended or the toggle went off. The email shows "Free", the Epic regular price struck through, "Claim by", a "Claim on Epic Games Store" button, and a footer naming the free-games reason.
- `epic-free.yml` daily 16:40 UTC: epic-free → alerts → `mood-tags --limit 50` (continue-on-error) → `embed-catalog` only if moods succeeded. Needs repo secret `GROQ_API_KEY` for the last two steps.

**Still to do, in order** (the user starts the next session later on 2026-10-17):
1. Once it has happened, check the first scheduled `daily.yml` run (2026-10-17 21:30 UTC = 2026-10-18 03:00 IST) in the Actions tab: success and duration. If resuming before then, skip to item 2 and come back to this. If slow, batch the per-listing queries in `lib/prices/service.ts` (`insertSnapshotIfChanged` / `refreshSummary` / `markFetched` are three round trips per listing, from a US runner to the Mumbai DB). Also glance at the first `digests.yml` run (03:30 UTC).
2. **Day 12: done** (see **Epic free games** below), committed locally but **not pushed yet** (ask the user, then push). The `GROQ_API_KEY` repo secret was added 2026-10-17. After pushing: the user ticks the free-games box on `/wishlist`, then watch the first `epic-free.yml` run (16:40 UTC, or run it by hand from the Actions tab) and confirm the free-game email arrives (Bad Cheese / Agent A are free until 2026-10-22 15:00 UTC).
3. **Day 13:**
   - 50-game hand-labelled video set (`video_eval_labels`; the user judges the videos);
   - a `/metrics` page + `sql/report.sql` (CTR, LLM vs fallback, cache hits, video accuracy);
   - responsive polish;
   - fuller privacy/terms pages.
4. **Day 14:** README with screenshots and results; buffer.

**Other leftovers:**
- The privacy page promises account deletion from a settings page; that doesn't exist yet (ask before building).
- Mood redo v2 still has to run for the remaining ~1,000 less popular games (`mood-tags.ts --redo`, then `embed-catalog.ts --all`, then clear `chat_cache`).
- Search has no typo tolerance (would need pg_trgm; ask first).

## Free-tier budgets to respect

| Service | Limit |
|---|---|
| YouTube Data API | 10k units/day (search 100, videos.list 1). Select a video once per game and cache it in `videos` |
| Groq | Per model: about 1000 requests/day, 8K tokens/min, about 200K tokens/day. A full mood-tag run of 2,000 games used about 160K tokens on `heavy` |
| Brevo email | 300/day, shared with Supabase magic-link SMTP. Alerts are capped near 200/day; the rest stay queued |
| Supabase | 500 MB storage. The schema's housekeeping deletes keep chat, cache and rate-limit rows bounded |
| IsThereAnyDeal | 1000 requests / 5 min |

## Working with this user

- The user is new to dev tooling. For anything outside the terminal (dashboards, API keys), give numbered click-by-click steps, one service at a time, and say exactly which `.env.local` line to fill. Never ask them to paste secrets into chat. Check keys by length or by test calls, without printing them.
- Before every commit, scan the staged diff for the actual values in `.env.local` and for `postgresql://`. Commit messages are descriptive; pushing to `main` deploys to production.

## Product constraints that are easy to get wrong

- The wishlist lives only in our DB. The UI must never imply it writes to the user's Steam or Epic wishlist.
- Steam links offer both the https store URL and `steam://store/<appid>`. Epic links offer the https URL and `com.epicgames.launcher://store/p/<slug>` (user decision, 2026-10-15), built from `store_listings.store_app_id` in `lib/prices/details.ts`.
- The "wait or buy?" hint only appears with enough history; otherwise the UI says tracking just started.
- Notifications are deduplicated by `notifications (user_id, dedupe_key)`, so a user never receives the same alert twice.
- Guests can chat but need an email account to wishlist.
- Email templates (alerts, digests, Supabase auth emails) must **never include the user's postal address** or the address on the Brevo account (user decision). Send only transactional mail (API/SMTP), never Brevo marketing campaigns, which add that address to the footer automatically. Footers carry the site name, why you got the email and the one-click unsubscribe link.
