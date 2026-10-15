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

# Offline scripts / jobs (tsx, load .env.local via scripts/env.ts)
npx tsx scripts/seed-igdb.ts [--released 1700] [--upcoming 300]   # catalog seed + ITAD id resolution (re-runnable, upserts)
npx tsx scripts/jobs/refresh-catalog-prices.ts [--country XX] [--report-unsold]  # prices for whole catalog in all 4 regions; report lists unpriced games
npx tsx scripts/rescue-editions.ts [--dry]                        # repoint delisted Steam originals to the edition Steam sells
npx tsx scripts/dedupe-editions.ts [--dry]                        # delete unpriced games whose sellable edition is already in catalog
npx tsx scripts/mood-tags.ts [--limit N]                          # LLM mood tags for games lacking them
npx tsx scripts/embed-catalog.ts [--all]                          # gte-small embeddings for games lacking them
npx tsx scripts/probe-itad.ts                                     # sanity-check ITAD Steam/Epic prices per region
npx tsx scripts/check-embed.ts                                    # edge-function vs local embedding parity (cosine should be 1.0)

# Database / edge function (Supabase CLI via npx; source .env.local first)
npx supabase db push --db-url "$DATABASE_URL"                     # apply supabase/migrations/*
npx supabase functions deploy embed --no-verify-jwt --project-ref <ref> --use-api
```

Run seed scripts in this order: seed-igdb, refresh-catalog-prices, rescue-editions, dedupe-editions, mood-tags, embed-catalog. Embeddings include tag text, so mood tags must exist first. `scripts/inspect-igdb.ts "<title>"`, `check-llm.ts` and `check-steam-fallback.ts` are debugging helpers. `scripts/test-videos.ts [released] [upcoming]` runs real video selection, and costs about 101 YouTube units per released game.

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
  - hard-reject walkthrough, ending, boss, part N, mobile and similar titles;
  - the game title must appear as a contiguous phrase that isn't followed by a sequel number;
  - score for an 8–15 minute length, an official channel (matching developer or publisher) or the reputable allowlist, and good title words.
  - A score ≥ 6 is accepted by rules; 3–5 goes to a `heavy` LLM yes/no check.
- If no overview qualifies, use the IGDB trailer.
- YouTube units are counted in `llm_usage_daily` scope `youtube:units` (cap 9000).

`components/VideoPlayer.tsx` uses the IFrame API on youtube-nocookie. Ending or closing the video triggers "Did that look good?" in `ResultCard.tsx`.

**Prices** (`lib/prices/`). `PriceProvider` is the interface and `itad.ts` (IsThereAnyDeal) the primary implementation. ITAD has no Steam price at all for about 6% of games that are on sale (e.g. Arma 3, Skyrim), so `service.ts` fills those gaps from Steam's public storefront API (`steamStore.ts`: batched `appdetails?filters=price_overview`, no key, regional via `cc`, free-to-play stored as price 0). Fallback prices have no history and no sale end date. Shop ids are Steam 61 and Epic 16; prices/v3 takes 200 ids per call, and amounts use `amountInt` minor units. Prices are stored in native currency per region, never converted. The regions are IN (default), US, GB and DE (standing in for the EU). `service.ts` rules:
- Write a `price_snapshots` row only when the price changes.
- `price_summary` holds the current price, the per-store all-time low (`storeLow` from ITAD) and `sale_count_12m` (the number of discount starts in the last 12 months).
- `price_fetch_state` drives a 6h on-demand TTL.
- The 12-month history is backfilled **lazily**, per listing and country, the first time it's needed (Buy popup or wishlist). This is tracked by `price_summary.history_backfilled_at`.
- The daily catalog refresh covers all four regions (user decision, so budget filters work everywhere) and passes `backfill: false`. `ensureFreshPrices` therefore also refreshes when a priced listing still lacks its backfill.
- ITAD `history/v2` rejects fractional seconds in `since`.
- `lib/prices/details.ts` builds the Buy popup data (`GET /api/games/[id]/prices`). History coverage counts as 12 months once backfilled. `lib/prices/hint.ts` is the wait-or-buy rule; it needs ≥ 6 months of coverage.
- ITAD doesn't list free Epic games (e.g. Fortnite), and there's no Epic fallback, so they show "Price unavailable".

**Catalog** (`lib/igdb/client.ts`, `scripts/seed-igdb.ts`). IGDB is throttled to about 3 requests per second. The seed takes:
- ~70% all-time most-rated PC games,
- ~30% most-rated from the last 3 years,
- the top 300 of Steam's "most wishlisted upcoming" (IGDB popularity type 10).

All of them must have a Steam or Epic external id. `resolveStores()` handles games with several Steam apps: it picks the ITAD product that currently has a price, then the highest appid, and gives duplicate ITAD products to the more popular IGDB entry. IGDB often points a base game at its delisted original (GTA V → appid 271590), while the sellable re-release is a separate IGDB entry typed as a bundle or expanded game. `rescue-editions.ts` fixes this with Steam store search, using `lib/catalog/editions.ts` to accept only "same title + edition words" matches. IGDB trailer ids are stored in `games.external_ids.igdb_videos` for later video selection, which saves YouTube quota. Playtime uses IGDB's `hastily` (main story) time-to-beat. Epic listings use the slug from the store URL.

**Scheduling.** Vercel Hobby cron only runs daily, so recurring jobs (price polling, digests, the Epic free-games check, catalog refresh) are planned as GitHub Actions running `scripts/jobs/*`. The repo is public, so Actions minutes are unlimited. Vercel functions are pinned to `bom1` (Mumbai) to sit next to the Supabase DB.

## Status and roadmap

The work follows a 14-day plan, and the live site is https://play-radar-ten.vercel.app. It deploys automatically on every push to `main`, and its env vars are set in the Vercel dashboard.

| Days | Scope | State |
|---|---|---|
| 1–2 | Setup, schema, seed, deployed skeleton | Done |
| 3–5 | Chat, filters, retrieval, caps, cache, fallback | Done |
| 6–7 | Video selection and spoiler filtering | Done. No scheduled backfill or re-check job yet |
| 8–9 | Region dropdown (header, `pr_region` cookie via `POST /api/region`; the home page renders per request), Buy popup (`BuyDialog.tsx`) comparing Steam and Epic cheapest-first, all-time-low badge, Recharts 3 history chart (lazy-loaded), wait-or-buy hint | Done |
| 10–11 | **Next.** Supabase magic-link auth via Brevo SMTP, wishlist (target price + any-sale / ATL / release toggles), alert emails with deduplication and a daily cap, instant/daily/weekly/off digests, GitHub Actions jobs (`prices.yml` every 4h, `daily.yml`, `digests.yml`) | Not started. User must create a Brevo account (no domain; single verified sender) |
| 12 | Epic free-games alerts (`epic-free.yml`, Epic `freeGamesPromotions` feed). The feedback loop already exists | Partly done |
| 13 | 50-game hand-labelled video set (`video_eval_labels`), `/metrics` page + `sql/report.sql` (CTR, LLM vs fallback, cache hits, video accuracy), responsive polish, fuller legal pages | Not started |
| 14 | Buffer, README with screenshots and results | Not started |

Current placeholder: **Wishlist** shows an alert. Vercel's `NEXT_PUBLIC_SITE_URL` is still `localhost`; it must become the live URL before auth redirects are added.

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
- Steam links offer both the https store URL and `steam://store/<appid>`. Epic links are web only.
- The "wait or buy?" hint only appears with enough history; otherwise the UI says tracking just started.
- Notifications are deduplicated by `notifications (user_id, dedupe_key)`, so a user never receives the same alert twice.
- Guests can chat but need an email account to wishlist.
