import type { GameCard as Game } from "@/lib/catalog/queries";
import { formatPrice } from "@/lib/format";

export function GameCard({ game }: { game: Game }) {
  const discount =
    game.min_price_cents != null && game.regular_cents
      ? Math.round(((game.regular_cents - game.min_price_cents) / game.regular_cents) * 100)
      : 0;
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="aspect-[3/4] bg-surface-2">
        {game.cover_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={game.cover_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="space-y-1 p-2">
        <h3 className="line-clamp-1 text-sm font-medium" title={game.title}>
          {game.title}
        </h3>
        <p className="line-clamp-1 text-xs text-muted">{game.tags.slice(0, 3).join(" · ")}</p>
        <p className="text-xs">
          {game.release_status === "upcoming" ? (
            <span className="text-muted">
              Coming {game.release_date ? new Date(game.release_date).getFullYear() : "soon"}
            </span>
          ) : game.min_price_cents != null && game.currency ? (
            <>
              {game.min_price_cents === 0 ? "Free" : formatPrice(game.min_price_cents, game.currency)}
              {discount > 0 && <span className="ml-1 rounded bg-sale/15 px-1 text-sale">-{discount}%</span>}
            </>
          ) : (
            <span className="text-muted">Price unavailable</span>
          )}
        </p>
      </div>
    </article>
  );
}
