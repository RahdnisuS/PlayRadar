export const metadata = { title: "Privacy — PlayRadar" };

export default function Privacy() {
  return (
    <article className="prose-invert max-w-2xl space-y-4 text-sm leading-6">
      <h1 className="text-2xl font-semibold">Privacy policy</h1>
      <p>
        PlayRadar is a personal, non-commercial project. We collect as little as we can and never sell or share your
        data.
      </p>
      <h2 className="text-lg font-semibold">What we store</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Your email address, if you create an account, so you can sign in and receive the alerts you ask for.</li>
        <li>Your wishlist, region and alert settings.</li>
        <li>
          Chat messages and the games we showed you, plus interactions such as video plays, likes and store clicks. We
          use these to improve recommendations. Guest chats are deleted after 30 days.
        </li>
        <li>A random guest cookie so daily usage limits work without an account.</li>
      </ul>
      <h2 className="text-lg font-semibold">Services we use</h2>
      <p>
        Supabase (database and sign-in), Vercel (hosting), Groq (AI responses; your chat message is sent to it), Brevo
        (email), YouTube (embedded videos, subject to Google&apos;s privacy policy), IGDB and IsThereAnyDeal (game and
        price data).
      </p>
      <h2 className="text-lg font-semibold">Your choices</h2>
      <p>
        Every email has a one-click unsubscribe link. You can delete your account and all associated data from the
        settings page.
      </p>
    </article>
  );
}
