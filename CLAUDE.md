# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PlayRadar is a zero-budget resume project. It's a conversational PC-game discovery and deal-tracking site covering **Steam and Epic only**; purchases never happen on our site. Users chat, and an LLM turns each message into structured filters. Those filters plus pgvector similarity return the top 5 games from **our own DB only**, so the model never invents games. Each result shows a spoiler-free YouTube video, a regional price comparison and wishlist alerts. The alert emails show the actual price, which is the key differentiator over Steam and Epic notifications.

Everything must stay within free tiers. Each external dependency sits behind an interface and has a non-LLM / non-API fallback. The user wants to be **asked before any major decision** (new service, schema redesign, changing a provider).

## Commands

```bash
npm run dev            # Next.js dev server
npm run build          # production build (the home page queries the DB at build time)
npm run lint           # ESLint
npx tsc --noEmit       # typecheck (CI runs lint + this; there are no tests yet)

# Offline scripts / jobs (tsx, load .env.local via scripts/env.ts)
npx tsx scripts/seed-igdb.ts [--released 1700] [--upcoming 300]   # catalog seed + ITAD id resolution (re-runnable, upserts)
npx tsx scripts/jobs/refresh-catalog-prices.ts [--report-unsold]  # IN prices for whole catalog; report lists unpriced games
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

Run seed scripts in this order: seed-igdb, refresh-catalog-prices, rescue-editions, dedupe-editions, mood-tags, embed-catalog. Embeddings include tag text, so mood tags must exist first. `scripts/inspect-igdb.ts "<title>"`, `check-llm.ts` and `check-steam-fallback.ts` are debugging helpers.

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

**Prices** (`lib/prices/`). `PriceProvider` is the interface and `itad.ts` (IsThereAnyDeal) the primary implementation. ITAD has no Steam price at all for about 6% of games that are on sale (e.g. Arma 3, Skyrim), so `service.ts` fills those gaps from Steam's public storefront API (`steamStore.ts`: batched `appdetails?filters=price_overview`, no key, regional via `cc`, free-to-play stored as price 0). Fallback prices have no history and no sale end date. Shop ids are Steam 61 and Epic 16; prices/v3 takes 200 ids per call, and amounts use `amountInt` minor units. Prices are stored in native currency per region, never converted. The regions are IN (default), US, GB and DE (standing in for the EU). `service.ts` rules:
- Write a `price_snapshots` row only when the price changes.
- `price_summary` holds the current price, the per-store all-time low (`storeLow` from ITAD) and `sale_count_12m` (the number of discount starts in the last 12 months).
- `price_fetch_state` drives a 6h on-demand TTL.
- The 12-month history is backfilled **lazily**, per listing and country, the first time it's needed (Buy popup or wishlist). This is tracked by `price_summary.history_backfilled_at`.
- The daily catalog refresh passes `backfill: false`.

**Catalog** (`lib/igdb/client.ts`, `scripts/seed-igdb.ts`). IGDB is throttled to about 3 requests per second. The seed takes:
- ~70% all-time most-rated PC games,
- ~30% most-rated from the last 3 years,
- the top 300 of Steam's "most wishlisted upcoming" (IGDB popularity type 10).

All of them must have a Steam or Epic external id. `resolveStores()` handles games with several Steam apps: it picks the ITAD product that currently has a price, then the highest appid, and gives duplicate ITAD products to the more popular IGDB entry. IGDB often points a base game at its delisted original (GTA V → appid 271590), while the sellable re-release is a separate IGDB entry typed as a bundle or expanded game. `rescue-editions.ts` fixes this with Steam store search, using `lib/catalog/editions.ts` to accept only "same title + edition words" matches. IGDB trailer ids are stored in `games.external_ids.igdb_videos` for later video selection, which saves YouTube quota. Playtime uses IGDB's `hastily` (main story) time-to-beat. Epic listings use the slug from the store URL.

**Scheduling.** Vercel Hobby cron only runs daily, so recurring jobs (price polling, digests, the Epic free-games check, catalog refresh) are planned as GitHub Actions running `scripts/jobs/*`. The repo is public, so Actions minutes are unlimited. Vercel functions are pinned to `bom1` (Mumbai) to sit next to the Supabase DB.

## Free-tier budgets to respect

| Service | Limit |
|---|---|
| YouTube Data API | 10k units/day (search 100, videos.list 1). Select a video once per game and cache it in `videos` |
| Brevo email | 300/day, shared with Supabase magic-link SMTP. Alerts are capped near 200/day; the rest stay queued |
| Supabase | 500 MB storage. The schema's housekeeping deletes keep chat, cache and rate-limit rows bounded |
| IsThereAnyDeal | 1000 requests / 5 min |

## Product constraints that are easy to get wrong

- The wishlist lives only in our DB. The UI must never imply it writes to the user's Steam or Epic wishlist.
- Steam links offer both the https store URL and `steam://store/<appid>`. Epic links are web only.
- The "wait or buy?" hint only appears with enough history; otherwise the UI says tracking just started.
- Notifications are deduplicated by `notifications (user_id, dedupe_key)`, so a user never receives the same alert twice.
- Guests can chat but need an email account to wishlist.
