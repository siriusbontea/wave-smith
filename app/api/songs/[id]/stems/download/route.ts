/**
 * GET /api/songs/[id]/stems/download — ZIP of all four stems (spec §9.3).
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getSongWithStems } from "@/lib/songs/queries";
import { env } from "@/lib/env";
import { safeFilename } from "@/lib/audio/ffmpeg";
import { createStemsZip } from "@/lib/audio/zip";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const song = getSongWithStems(id);
  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (song.stems.length !== 4) {
    return NextResponse.json({ error: "Stems not ready — generate them first" }, { status: 404 });
  }

  const entries = song.stems.map((s) => {
    const abs = path.resolve(env.audioDir, s.path);
    if (!abs.startsWith(env.audioDir + path.sep) || !fs.existsSync(abs)) {
      throw new Error(`Stem file missing: ${s.stemName}`);
    }
    return { name: `${s.stemName}.wav`, abs };
  });

  const zipPath = path.join(env.audioDir, id, "stems.zip");
  await createStemsZip(entries, zipPath);

  const stat = fs.statSync(zipPath);
  const stream = fs.createReadStream(zipPath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${safeFilename(song.title, "zip").replace(/\.zip$/, "-stems.zip")}"`,
    },
  });
}
