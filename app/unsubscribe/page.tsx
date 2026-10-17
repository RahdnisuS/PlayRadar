import Link from "next/link";

export const metadata = { title: "Unsubscribe — PlayRadar", robots: { index: false } };

/** Landing page for the email footer link. One button press stops all PlayRadar emails. */
export default async function Unsubscribe({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-surface p-6 text-sm">
      <h1 className="text-xl font-semibold">Email settings</h1>
      {sp.done ? (
        <>
          <p>You&apos;re unsubscribed. PlayRadar won&apos;t send you wishlist or free-game emails any more.</p>
          <p className="text-muted">
            Your wishlist is still saved. To turn emails back on, sign in and open{" "}
            <Link href="/wishlist" className="text-accent underline">My wishlist</Link>.
          </p>
        </>
      ) : sp.invalid || !sp.token ? (
        <p>
          This unsubscribe link isn&apos;t valid. You can change your email settings on{" "}
          <Link href="/wishlist" className="text-accent underline">My wishlist</Link> after signing in.
        </p>
      ) : (
        <form method="post" action="/api/unsubscribe" className="space-y-3">
          <input type="hidden" name="token" value={sp.token} />
          <input type="hidden" name="from" value="page" />
          <p>Stop all wishlist and free-game emails from PlayRadar? Your wishlist stays saved.</p>
          <button type="submit" className="rounded-md bg-accent px-3 py-2 font-medium text-bg hover:bg-accent-strong">
            Unsubscribe from all emails
          </button>
        </form>
      )}
    </div>
  );
}
