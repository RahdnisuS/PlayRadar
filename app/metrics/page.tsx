import { getMetrics, type Metrics } from "@/lib/metrics";

export const metadata = { title: "Metrics — PlayRadar" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOURCE_LABELS: Record<string, string> = {
  llm: "LLM (Groq)",
  fallback: "Keyword fallback",
  cache_exact: "Cache, exact match",
  cache_similar: "Cache, similar wording",
  similar: "“More like this”",
  unknown: "Fallback or cache (before tracking)",
};

const EVENT_LABELS: Record<string, string> = {
  video_played: "Played the video",
  video_finished: "Watched to the end",
  liked: "“Looks good”, opened prices",
  wishlisted: "Added to wishlist",
  store_click: "Clicked through to a store",
  not_interested: "“Not for me”",
};

const ALERT_LABELS: Record<string, string> = {
  sale: "On sale",
  all_time_low: "All-time low",
  target_hit: "Target price reached",
  released: "Released",
  free_to_claim: "Free on Epic",
};

const VIDEO_KINDS: Record<string, string> = {
  gameplay_overview: "Gameplay overview",
  gameplay_trailer: "Gameplay trailer",
  trailer: "Trailer",
};

const pct =(n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");
const num = (n: number) => n.toLocaleString("en-US");

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

/** One horizontal bar per row, scaled to `max`; the number sits in text colour beside the bar. */
function Bars({ rows, max }: { rows: { label: string; value: number; display?: string }[]; max: number }) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[14rem_1fr_auto]">
          <span className="truncate text-muted" title={r.label}>{r.label}</span>
          <span className="h-2 rounded-full bg-surface-2" title={`${r.label}: ${r.display ?? num(r.value)}`}>
            <span
              className="block h-2 rounded-full bg-accent"
              style={{ width: `${max ? Math.max((100 * r.value) / max, r.value ? 2 : 0) : 0}%` }}
            />
          </span>
          <span className="min-w-16 text-right tabular-nums">{r.display ?? num(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {intro && <p className="text-sm text-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">{children}</p>;
}

export default async function MetricsPage() {
  const m: Metrics = await getMetrics();
  const turns = m.turns.reduce((s, t) => s + t.total, 0);
  const count = (src: string) => m.turns.find((t) => t.source === src)?.total ?? 0;
  const llm = count("llm");
  const fallback = count("fallback");
  const cached = count("cache_exact") + count("cache_similar");
  // Cache hit rate only over typed messages since tracking began ("More like this" never uses the cache).
  const tracked = llm + fallback + cached;
  const evalDone = m.eval.labelled > 0;

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Metrics</h1>
        <p className="max-w-2xl text-sm text-muted">
          How PlayRadar is doing, live from the database: how chat messages get answered, what people do with the 5
          games they are shown, and how often the chosen video is a good one. Counts only; no messages or personal
          data.{m.since && ` Tracking since ${m.since.slice(0, 10)}.`}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Chat messages" value={num(turns)} note={`${num(m.turns.reduce((s, t) => s + t.week, 0))} in the last 7 days`} />
        <Tile label="Answered by the LLM" value={pct(llm, turns)} note="the rest by fallback, cache or “more like this”" />
        <Tile label="Click-through rate" value={pct(m.recs.engaged, m.recs.shown)} note={`of ${num(m.recs.shown)} games shown`} />
        <Tile
          label="Video accuracy"
          value={evalDone ? pct(m.eval.correct, m.eval.labelled) : "–"}
          note={evalDone ? `${m.eval.correct} of ${m.eval.labelled} hand-labelled games` : "hand-labelled set not done yet"}
        />
      </div>

      <Section
        title="How messages are answered"
        intro="An LLM turns each message into search filters. If the daily budget is used up or the model fails, a keyword parser takes over. Repeated questions are answered from a one-day cache."
      >
        {turns ? (
          <>
            <Bars
              rows={m.turns.map((t) => ({ label: SOURCE_LABELS[t.source] ?? t.source, value: t.total, display: `${num(t.total)} · ${pct(t.total, turns)}` }))}
              max={Math.max(...m.turns.map((t) => t.total))}
            />
            <p className="text-sm text-muted">
              Cache hit rate: <span className="text-text tabular-nums">{pct(cached, tracked)}</span> of typed messages
              since tracking began ({num(cached)} of {num(tracked)}).
            </p>
          </>
        ) : (
          <Empty>No chat messages yet.</Empty>
        )}
      </Section>

      <Section
        title="What people do with recommendations"
        intro="Each chat answer shows up to 5 games. A game counts as clicked when someone plays its video, opens its prices, wishlists it or clicks through to a store."
      >
        {m.recs.shown ? (
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Share of shown games with each action</h3>
              <Bars
                rows={Object.entries(m.recs.byEvent).map(([t, n]) => ({ label: EVENT_LABELS[t] ?? t, value: n, display: pct(n, m.recs.shown) }))}
                max={m.recs.shown}
              />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Click-through rate by position</h3>
              <Bars
                rows={m.byRank.map((r) => ({ label: `#${r.rank} (${num(r.shown)} shown)`, value: r.shown ? r.engaged / r.shown : 0, display: pct(r.engaged, r.shown) }))}
                max={1}
              />
            </div>
          </div>
        ) : (
          <Empty>No recommendations shown yet.</Empty>
        )}
      </Section>

      <Section
        title="Videos"
        intro="Each game gets one spoiler-free video, picked when someone first asks for it: a gameplay overview chosen by title rules (borderline ones checked by an LLM), or the official trailer."
      >
        <div className="grid gap-8 md:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Selected videos by type</h3>
            {m.videos.length ? (
              <Bars
                rows={m.videos.map((v) => ({
                  label: `${VIDEO_KINDS[v.kind] ?? v.kind} ·${v.classifiedBy === "llm" ? "LLM-checked" : v.classifiedBy === "human" ? "human" : "rules"}`,
                  value: v.n,
                }))}
                max={Math.max(...m.videos.map((v) => v.n))}
              />
            ) : (
              <Empty>No videos selected yet.</Empty>
            )}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">After watching a video</h3>
            {m.afterVideo.played ? (
              <Bars
                rows={[
                  { label: "Liked or wishlisted", value: m.afterVideo.good, display: pct(m.afterVideo.good, m.afterVideo.played) },
                  { label: "“Not for me”", value: m.afterVideo.notForMe, display: pct(m.afterVideo.notForMe, m.afterVideo.played) },
                  {
                    label: "No answer",
                    value: m.afterVideo.played - m.afterVideo.good - m.afterVideo.notForMe,
                    display: pct(m.afterVideo.played - m.afterVideo.good - m.afterVideo.notForMe, m.afterVideo.played),
                  },
                ]}
                max={m.afterVideo.played}
              />
            ) : (
              <Empty>No videos played from recommendations yet.</Empty>
            )}
            <p className="text-sm text-muted">
              {evalDone
                ? `Against a hand-labelled set, the chosen video was acceptable for ${m.eval.correct} of ${m.eval.labelled} games` +
                  (m.eval.withVideo < m.eval.labelled ? ` (${m.eval.labelled - m.eval.withVideo} had no video selected).` : ".")
                : "Video accuracy will be measured against a hand-labelled set of 50 games."}
            </p>
          </div>
        </div>
      </Section>

      <Section title="Alerts" intro="Wishlist price alerts and Epic free-game emails. Dropped means the sale ended or the setting was turned off before sending.">
        {m.alerts.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 pr-4 font-normal">Type</th>
                  <th className="py-1 pr-4 text-right font-normal">Sent</th>
                  <th className="py-1 pr-4 text-right font-normal">Dropped</th>
                  <th className="py-1 text-right font-normal">Queued</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {m.alerts.map((a) => (
                  <tr key={a.type} className="border-t border-border">
                    <td className="py-1.5 pr-4">{ALERT_LABELS[a.type] ?? a.type}</td>
                    <td className="py-1.5 pr-4 text-right">{num(a.sent)}</td>
                    <td className="py-1.5 pr-4 text-right">{num(a.dropped)}</td>
                    <td className="py-1.5 text-right">{num(a.queued)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No alerts yet.</Empty>
        )}
      </Section>

      <Section title="Free-tier budgets today" intro="Everything runs on free tiers, with daily caps kept below each provider's limit. Days are UTC.">
        <Bars rows={m.today.map((t) => ({ label: t.label, value: t.used / t.cap, display: `${num(t.used)} / ${num(t.cap)}` }))} max={1} />
      </Section>

      <p className="text-xs text-muted">
        Catalog: {num(m.catalog.games)} games, {num(m.catalog.priced)} with a current Steam or Epic price,{" "}
        {num(m.catalog.videos)} with a video chosen.
      </p>
    </div>
  );
}
