/**
 * POST /api/songs/[id]/stems — enqueue a Demucs separation job (spec §7, M5).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { demucsAvailable } from "@/lib/audio/demucs";
import { getSong } from "@/lib/songs/queries";
import { getQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    idempotencyKey: z.string().min(8).max(80).optional(),
  })
  .strict();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getSong(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!demucsAvailable()) {
    return NextResponse.json(
      {
        error:
          "The tool that splits a song into parts is not installed yet. Ask whoever set up Wavesmith to finish setup.",
      },
      { status: 503 },
    );
  }
  let idempotencyKey: string | undefined;
  const text = await req.text();
  if (text.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    idempotencyKey = parsed.data.idempotencyKey;
  }
  const placed = getQueue().submit("stems", { songId: id, idempotencyKey });
  return NextResponse.json({ jobId: placed.id, merged: placed.merged }, { status: 202 });
}
