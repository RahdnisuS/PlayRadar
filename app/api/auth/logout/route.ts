import { supabaseServer } from "@/lib/auth/identity";

export const runtime = "nodejs";

export async function POST() {
  await (await supabaseServer()).auth.signOut();
  return Response.json({ ok: true });
}
