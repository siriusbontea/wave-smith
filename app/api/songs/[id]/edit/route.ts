/**
 * POST /api/songs/[id]/edit — queue a section repaint or an extend.
 *
 * The client sends lyrics and a time range (or seconds to add). The source
 * audio path is resolved here from the library row, never accepted from the
 * browser. Audio stays on the local ACE-Step engine.
 */
import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getQueue } from "@/lib/queue";
import { getSong, songAudioAbsPath } from "@/lib/songs/queries";
import { clampRepaintWindow, extendWindow } from "@/lib/songs/sections";

export const dynamic = "force-dynamic";

const EditSchema = z
  .object({
    action: z.enum(["repaint", "extend"]),
    lyrics: z.string().max(10_000).default(""),
    startS: z.number().min(0).max(600).optional(),
    endS: z.number().min(0).max(600).optional(),
    extendS: z.number().min(10).max(120).optional(),
    sectionLabel: z.string().trim().max(40).optional(),
    vocalLanguage: z.string().max(10).optional(),
  })
  .strict();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const song = getSong(id);
  if (!song) return NextResponse.json({ error: "Song not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const parsed = EditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (song.durationS == null || song.durationS <= 0) {
    return NextResponse.json(
      { error: "This song has no duration yet, so a section can't be placed on the timeline." },
      { status: 400 },
    );
  }

  const abs = songAudioAbsPath(song);
  if (!abs || !fs.existsSync(abs)) {
    return NextResponse.json(
      { error: "Original audio is missing on disk — can't edit this song." },
      { status: 400 },
    );
  }

  const timeSignature =
    song.timeSignature === "2" ||
    song.timeSignature === "3" ||
    song.timeSignature === "4" ||
    song.timeSignature === "6"
      ? song.timeSignature
      : undefined;

  if (parsed.data.action === "repaint") {
    if (parsed.data.startS === undefined || parsed.data.endS === undefined) {
      return NextResponse.json(
        { error: "Pick a section to regenerate." },
        { status: 400 },
      );
    }
    const window = clampRepaintWindow(song.durationS, parsed.data.startS, parsed.data.endS);
    if (!window) {
      return NextResponse.json(
        { error: "That section is too short to regenerate. It needs at least a second." },
        { status: 400 },
      );
    }
    const jobId = getQueue().enqueue("generate", {
      prompt: song.prompt,
      lyrics: parsed.data.lyrics,
      instrumental: false,
      variations: 1,
      durationS: song.durationS,
      bpm: song.bpm ?? undefined,
      keyScale: song.keyScale ?? undefined,
      timeSignature,
      vocalLanguage: parsed.data.vocalLanguage,
      edit: {
        kind: "repaint",
        parentSongId: song.id,
        srcAudioPath: abs,
        repaintingStart: window.start,
        repaintingEnd: window.end,
        sectionLabel: parsed.data.sectionLabel,
      },
    });
    return NextResponse.json({ jobId }, { status: 202 });
  }

  if (parsed.data.extendS === undefined) {
    return NextResponse.json({ error: "Choose how many seconds to add." }, { status: 400 });
  }
  const window = extendWindow(song.durationS, parsed.data.extendS);
  if ("error" in window) {
    return NextResponse.json({ error: window.error }, { status: 400 });
  }
  const jobId = getQueue().enqueue("generate", {
    prompt: song.prompt,
    lyrics: parsed.data.lyrics,
    instrumental: false,
    variations: 1,
    durationS: window.target,
    bpm: song.bpm ?? undefined,
    keyScale: song.keyScale ?? undefined,
    timeSignature,
    vocalLanguage: parsed.data.vocalLanguage,
    edit: {
      kind: "extend",
      parentSongId: song.id,
      srcAudioPath: abs,
      repaintingStart: window.start,
      repaintingEnd: window.end,
      targetDurationS: window.target,
      sectionLabel: parsed.data.sectionLabel ?? "extended",
    },
  });
  return NextResponse.json({ jobId }, { status: 202 });
}
