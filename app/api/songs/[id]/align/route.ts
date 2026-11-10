/**
 * POST /api/songs/[id]/align — queue a local lyric-timing job.
 *
 * The audio path is resolved from the library (vocals stem when it exists,
 * otherwise the mix). Language is the vocal language already chosen in the UI.
 */
import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getQueue } from "@/lib/queue";
import { getSong, listStemsForSong, songAudioAbsPath } from "@/lib/songs/queries";
import { ALIGNER_MISSING, alignerAvailable } from "@/lib/audio/align";
import { VOCAL_LANGUAGES } from "@/lib/lyrics/language";

export const dynamic = "force-dynamic";

const AlignSchema = z
  .object({
    vocalLanguage: z.string().max(10).default("en"),
  })
  .strict();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const song = getSong(id);
  if (!song) return NextResponse.json({ error: "Song not found" }, { status: 404 });

  let body: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }
  }
  const parsed = AlignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const lyrics = song.lyrics?.trim() ?? "";
  if (!lyrics || lyrics === "[inst]" || lyrics === "[instrumental]") {
    return NextResponse.json(
      { error: "Add lyrics before timing them. Instrumentals have nothing to align." },
      { status: 400 },
    );
  }

  const vocals = listStemsForSong(id).find((stem) => stem.stemName === "vocals");
  const audioAbs = vocals ? songAudioAbsPath({ ...song, audioPath: vocals.path }) : songAudioAbsPath(song);
  if (!audioAbs || !fs.existsSync(audioAbs)) {
    return NextResponse.json(
      { error: "Audio is missing on disk — can't time the lyrics." },
      { status: 400 },
    );
  }

  if (!alignerAvailable()) {
    return NextResponse.json({ error: ALIGNER_MISSING }, { status: 503 });
  }

  const language = (VOCAL_LANGUAGES as readonly string[]).includes(parsed.data.vocalLanguage)
    ? parsed.data.vocalLanguage
    : "en";
  const jobId = getQueue().enqueue("align", { songId: id, vocalLanguage: language });
  return NextResponse.json({ jobId }, { status: 202 });
}
