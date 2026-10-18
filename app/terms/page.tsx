import Link from "next/link";

export const metadata = { title: "Terms — PlayRadar" };

const H2 = "pt-2 text-lg font-semibold";
const UL = "list-disc space-y-1 pl-5";

export default function Terms() {
  return (
    <article className="max-w-2xl space-y-4 text-sm leading-6">
      <h1 className="text-2xl font-semibold">Terms and disclaimer</h1>
      <p className="text-xs text-muted">Last updated 18 October 2026</p>
      <p>
        PlayRadar is a free, personal project that helps you discover PC games and compare prices on Steam and the Epic
        Games Store. By using it you agree to these terms.
      </p>

      <h2 className={H2}>We don&apos;t sell games</h2>
      <p>
        Purchases happen on Steam or the Epic Games Store, under their terms and prices. PlayRadar never takes payment
        and never sees your store accounts.
      </p>

      <h2 className={H2}>Prices and alerts may be wrong or late</h2>
      <ul className={UL}>
        <li>
          Prices come from IsThereAnyDeal and the Steam store and are refreshed on a schedule, so they can be out of
          date. <strong>Always confirm the price on the store page before buying.</strong>
        </li>
        <li>
          Alert emails are sent on a best-effort basis. They can arrive late, land in a spam or promotions folder, or
          not be sent at all (for example when the daily email limit is reached). A sale can end before you read the
          email.
        </li>
        <li>Free-game information comes from the Epic Games Store. Check the claim deadline on Epic.</li>
        <li>The &ldquo;wait or buy?&rdquo; hint is a guess based on past prices, not a promise about future sales.</li>
      </ul>

      <h2 className={H2}>Recommendations and videos</h2>
      <p>
        Suggestions are picked automatically, partly by an AI model, from our own catalog. They can be off. Videos are
        third-party YouTube content chosen automatically to avoid spoilers, but we can&apos;t guarantee a video is
        spoiler-free or suitable for everyone.
      </p>

      <h2 className={H2}>Your wishlist</h2>
      <p>
        Your PlayRadar wishlist lives on this site only. It doesn&apos;t read or change your Steam or Epic wishlist.
      </p>

      <h2 className={H2}>Fair use</h2>
      <ul className={UL}>
        <li>The chat has daily limits (10 messages for guests, 30 with an account) to keep the free service running.</li>
        <li>Please don&apos;t scrape the site, automate requests, or try to get around the limits.</li>
        <li>We may block access or remove accounts that abuse the service.</li>
      </ul>

      <h2 className={H2}>Trademarks and data sources</h2>
      <p>
        PlayRadar is not affiliated with, endorsed by or sponsored by Valve, Steam, Epic Games or the Epic Games Store.
        Game names, covers and trademarks belong to their owners. Game data comes from IGDB, prices from IsThereAnyDeal
        and the Steam store, and videos from YouTube.
      </p>

      <h2 className={H2}>No warranty</h2>
      <p>
        The service is provided as-is and free of charge, without any warranty. As far as the law allows, PlayRadar is
        not liable for losses from using it, such as a purchase made at a price shown here. The service may change or
        stop at any time.
      </p>

      <p>
        See also the <Link className="underline" href="/privacy">privacy policy</Link>.
      </p>
    </article>
  );
}
