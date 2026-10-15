// Who is chatting: a signed-in Supabase user, or a guest identified by a signed, httpOnly cookie.
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Identity } from "../llm/caps";

const GUEST_COOKIE = "pr_guest";

function sign(token: string) {
  return createHmac("sha256", process.env.GUEST_TOKEN_SECRET!).update(token).digest("base64url");
}

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component; middleware refreshes the session instead.
        }
      },
    },
  });
}

export async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await (await supabaseServer()).auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** The guest token from a validly signed pr_guest cookie, if any (also present after the guest signs in). */
export async function guestToken(): Promise<string | null> {
  const raw = (await cookies()).get(GUEST_COOKIE)?.value;
  if (!raw) return null;
  const [token, sig] = raw.split(".");
  const expected = sign(token ?? "");
  return sig && sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? token : null;
}

/** Returns the signed-in user, or the guest token (creating the cookie on first visit). */
export async function getIdentity(): Promise<Identity> {
  const userId = await currentUserId();
  if (userId) return { kind: "user", userId };

  const existing = await guestToken();
  if (existing) return { kind: "guest", token: existing };
  const store = await cookies();
  const token = randomUUID();
  store.set(GUEST_COOKIE, `${token}.${sign(token)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return { kind: "guest", token };
}
