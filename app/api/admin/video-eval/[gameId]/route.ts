// Owner-only: label one game's selected video in the evaluation set (PUT) or clear the label (DELETE).
import { z } from "zod";
import { isAdmin } from "@/lib/auth/admin";
import { clearEvalLabel, saveEvalLabel } from "@/lib/video/eval";
import { BAD_REASONS } from "@/lib/video/evalTypes";

export const runtime = "nodejs";

const Body = z.object({ good: z.boolean(), reason: z.enum(BAD_REASONS).nullable().default(null) });

async function parseId(params: Promise<{ gameId: string }>) {
  const { gameId } = await params;
  return /^\d+$/.test(gameId) ? gameId : null;
}

export async function PUT(req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  const gameId = await parseId(params);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!gameId || !parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const ok = await saveEvalLabel(gameId, parsed.data.good, parsed.data.good ? null : parsed.data.reason);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "not in the evaluation set" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  const gameId = await parseId(params);
  if (!gameId) return Response.json({ error: "bad request" }, { status: 400 });
  await clearEvalLabel(gameId);
  return Response.json({ ok: true });
}
