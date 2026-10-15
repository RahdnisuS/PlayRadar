/** Only same-site relative paths, so a sign-in link can't be turned into an open redirect. */
export function safeNext(next: string | undefined | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
