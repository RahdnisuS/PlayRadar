import Link from "next/link";

export const metadata = { title: "Privacy — PlayRadar" };

const H2 = "pt-2 text-lg font-semibold";
const UL = "list-disc space-y-1 pl-5";

export default function Privacy() {
  return (
    <article className="max-w-2xl space-y-4 text-sm leading-6">
      <h1 className="text-2xl font-semibold">Privacy policy</h1>
      <p className="text-xs text-muted">Last updated 18 October 2026</p>
      <p>
        PlayRadar is a personal, non-commercial project. We collect as little as we can, show no ads, use no analytics
        or tracking scripts, and never sell or share your data with anyone except the services listed below, which we
        need to run the site.
      </p>

      <h2 className={H2}>What we store</h2>
      <ul className={UL}>
        <li>
          <strong>Your email address</strong>, if you create an account, so you can sign in and receive the emails you
          ask for. There are no passwords: you sign in with a link sent to your email.
        </li>
        <li>
          <strong>Your wishlist</strong>, target prices, alert settings, email preferences and price region.
        </li>
        <li>
          <strong>Chat messages</strong> and the games we showed you, plus what you did with them (video plays,
          &ldquo;looks good&rdquo;, &ldquo;not for me&rdquo;, wishlist adds and store clicks). We use these to
          improve recommendations and to publish anonymous totals on the <Link className="underline" href="/metrics">metrics page</Link>.
          If you are signed in, &ldquo;not for me&rdquo; and similar feedback also tunes future suggestions for you.
        </li>
        <li>
          <strong>Your IP address</strong>, only inside short-lived rate-limit counters that stop abuse of the chat and
          sign-in. These are deleted after two days.
        </li>
        <li>
          <strong>A record of the alert emails we sent you</strong>, so you never get the same alert twice.
        </li>
      </ul>

      <h2 className={H2}>Cookies</h2>
      <ul className={UL}>
        <li><code>pr_guest</code>: a random, signed id so daily chat limits work without an account (1 year).</li>
        <li><code>pr_region</code>: the price region you picked (1 year).</li>
        <li><code>sb-…</code>: your sign-in session, only if you sign in.</li>
      </ul>
      <p>
        All of them are needed for the site to work, so there is no cookie banner. Videos play through
        YouTube&apos;s privacy-enhanced mode (youtube-nocookie.com); YouTube may set its own cookies once you press
        play.
      </p>

      <h2 className={H2}>How long we keep it</h2>
      <ul className={UL}>
        <li>Guest chats (without an account): deleted after 90 days.</li>
        <li>Account data, including chats made while signed in: until you delete your account.</li>
        <li>Rate-limit counters: 2 days. Usage counters with your account id: 30 days.</li>
      </ul>

      <h2 className={H2}>Services we use</h2>
      <ul className={UL}>
        <li><strong>Supabase</strong>: database and sign-in (servers in Mumbai, India).</li>
        <li><strong>Vercel</strong>: website hosting.</li>
        <li><strong>GitHub Actions</strong>: runs the scheduled jobs that check prices and send alerts.</li>
        <li>
          <strong>Groq</strong>: AI responses. The text of your chat message is sent to it to work out what you are
          looking for. Your email address is not.
        </li>
        <li><strong>Brevo</strong>: sends sign-in links and alert emails, so it receives your email address and the email content.</li>
        <li><strong>YouTube</strong>: embedded videos, under Google&apos;s privacy policy.</li>
        <li>
          <strong>IGDB, IsThereAnyDeal, the Steam store and the Epic Games Store</strong>: game, price and giveaway data.
          They receive no personal data from us.
        </li>
      </ul>

      <h2 className={H2}>Your choices</h2>
      <ul className={UL}>
        <li>Every email has a one-click unsubscribe link.</li>
        <li>
          You can change or pause alert emails, and <strong>delete your account and all its data</strong>, on your{" "}
          <Link className="underline" href="/wishlist">wishlist page</Link>. Deletion is immediate and can&apos;t be undone.
        </li>
        <li>You can use the chat without an account at all.</li>
      </ul>

      <h2 className={H2}>Other</h2>
      <p>
        PlayRadar is not meant for children under 13. If this policy changes, the date at the top changes too.
        Questions: open an issue on the project&apos;s{" "}
        <a className="underline" href="https://github.com/RahdnisuS/PlayRadar/issues">GitHub page</a> (please don&apos;t
        post your email address there).
      </p>
    </article>
  );
}
