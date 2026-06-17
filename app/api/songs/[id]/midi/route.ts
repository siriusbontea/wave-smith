/**
 * POST /api/songs/[id]/midi — enqueue Basic Pitch transcription (approximate MIDI).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { basicPitchAvailable } from "@/lib/audio/basic-pitch";
import { MIDI_SOURCES } from "@/db/schema";
import { getSong, listStemsForSong } from "@/lib/songs/queries";
import { getQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  source: z.enum(MIDI_SOURCES),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getSong(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!basicPitchAvailable()) {
    return NextResponse.json(
      {
        error:
          "basic-pitch is not installed. Run ./scripts/setup.sh — MIDI transcription needs the basic-pitch CLI.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  if (parsed.data.source !== "master") {
    const stem = listStemsForSong(id).find((s) => s.stemName === parsed.data.source);
    if (!stem) {
      return NextResponse.json(
        { error: `Stem "${parsed.data.source}" not ready — generate stems first, or use source "master".` },
        { status: 400 },
      );
    }
  }

  const jobId = getQueue().enqueue("midi", { songId: id, source: parsed.data.source });
  return NextResponse.json({ jobId }, { status: 202 });
}
