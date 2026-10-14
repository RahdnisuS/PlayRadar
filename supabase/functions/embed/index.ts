// Query embeddings with Supabase's built-in gte-small (384-dim), the same model used offline
// for the catalog (Supabase/gte-small). Called only by our server, which sends EMBED_SECRET.
const model = new Supabase.ai.Session("gte-small");

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${Deno.env.get("EMBED_SECRET")}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const { input } = await req.json();
  if (typeof input !== "string" || input.length === 0 || input.length > 2000) {
    return new Response("bad input", { status: 400 });
  }
  const embedding = await model.run(input, { mean_pool: true, normalize: true });
  return Response.json({ embedding });
});
