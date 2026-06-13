/**
 * GET /api/songs/[id]/download?format=wav|mp3 — download a take.
 * WAV streams the master directly; MP3 is encoded on demand via ffmpeg and
 * cached next to the master (spec §9.3 downloads).
 */
import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getSong, songAudioAbsPath } from "@/lib/songs/queries";
import { ensureMp3, safeFilename } from "@/lib/audio/ffmpeg";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const song = getSong(id);
  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const masterAbs = songAudioAbsPath(song);
  if (!masterAbs || !fs.existsSync(masterAbs)) {
    return NextResponse.json({ error: "Audio file missing" }, { status: 404 });
  }

  const format = new URL(req.url).searchParams.get("format") === "mp3" ? "mp3" : "wav";

  let fileAbs = masterAbs;
  let contentType = "audio/wav";
  if (format === "mp3") {
    try {
      fileAbs = await ensureMp3(masterAbs);
      contentType = "audio/mpeg";
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "MP3 encode failed" },
        { status: 500 },
      );
    }
  }

  const stat = fs.statSync(fileAbs);
  const stream = fs.createReadStream(fileAbs);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${safeFilename(song.title, format)}"`,
    },
  });
}
