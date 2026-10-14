// Query embeddings via the Supabase edge function (gte-small, 384-dim). Returns null on failure so
// retrieval can still run on filters + tag overlap alone.
export async function embedQuery(text: string): Promise<number[] | null> {
  const input = text.trim().slice(0, 2000);
  if (!input) return null;
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/embed`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.EMBED_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const { embedding } = await r.json();
    return Array.isArray(embedding) && embedding.length === 384 ? embedding : null;
  } catch {
    return null;
  }
}

export const toPgVector = (v: number[] | null) => (v ? `[${v.join(",")}]` : null);
