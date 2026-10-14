import { GameCard } from "@/components/GameCard";
import { getGameCards, type GameCard as Game } from "@/lib/catalog/queries";

export const revalidate = 3600;

export default async function Home() {
  const [popular, upcoming] = await Promise.all([
    getGameCards("g.release_status <> 'upcoming'", [], "IN", 12),
    getGameCards("g.release_status = 'upcoming'", [], "IN", 6),
  ]);
  return (
    <div className="space-y-10">
      <section className="space-y-3 py-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Tell us what you feel like playing.</h1>
        <p className="max-w-2xl text-muted">
          Describe a mood, genre, budget or how long you&apos;ve got. PlayRadar picks five PC games from Steam and
          Epic, shows a spoiler-free video for each, and compares prices across both stores.
        </p>
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          Chat assistant coming soon.
        </div>
      </section>
      <Shelf title="Popular on Steam & Epic" games={popular} />
      <Shelf title="Most wishlisted upcoming" games={upcoming} />
    </div>
  );
}

function Shelf({ title, games }: { title: string; games: Game[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {games.map((g) => (
          <GameCard key={g.id} game={g} />
        ))}
      </div>
    </section>
  );
}
