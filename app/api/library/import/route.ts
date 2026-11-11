/**
 * POST /api/library/import — restore library rows from an export file
 * (spec §9.3). Metadata only: upsert by id, leave existing audio untouched.
 * Songs whose audio is absent on disk are reported but still imported (the
 * row round-trips; playback 404s until the audio is restored).
 */
import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { authorizeWrite, classifyRequest } from "@/lib/phone/access";
import { env } from "@/lib/env";
import path from "node:path";

export const dynamic = "force-dynamic";

const SongSchema = z.object({
  id: z.string().min(1),
  title: z.string().default("Untitled"),
  prompt: z.string().default(""),
  lyrics: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  bpm: z.number().nullable().default(null),
  keyScale: z.string().nullable().default(null),
  timeSignature: z.string().nullable().default(null),
  durationS: z.number().nullable().default(null),
  seed: z.string().nullable().default(null),
  model: z.string().default("unknown"),
  variationGroupId: z.string().default(""),
  audioPath: z.string().min(1),
  lrc: z.string().nullable().default(null),
  lyricTimings: z
    .object({
      source: z.enum(["aligned", "mock"]),
      lines: z.array(
        z.object({
          text: z.string(),
          startS: z.number(),
          endS: z.number(),
          words: z.array(z.object({ text: z.string(), startS: z.number(), endS: z.number() })),
        }),
      ),
    })
    .nullable()
    .optional(),
  qualityScore: z.number().nullable().default(null),
  artSeed: z.string().default(""),
  favorite: z.boolean().default(false),
  createdAt: z.number(),
});
const ImportSchema = z.object({
  wavesmithLibrary: z.number().optional(),
  songs: z.array(SongSchema).max(10_000),
});

export async function POST(req: Request) {
  const kind = classifyRequest(req);
  const write = authorizeWrite(req, kind);
  if (!write.ok) return NextResponse.json({ error: write.error }, { status: write.status });
  if (kind === "phone") {
    return NextResponse.json({ error: "Import the library on the computer." }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const parsed = ImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Not a Wavesmith library export" }, { status: 400 });
  }

  let imported = 0;
  let missingAudio = 0;
  for (const s of parsed.data.songs) {
    const abs = path.resolve(env.audioDir, s.audioPath);
    if (!abs.startsWith(env.audioDir + path.sep)) continue; // reject path tricks
    if (!fs.existsSync(abs)) missingAudio++;
    const row = {
      ...s,
      tags: JSON.stringify(s.tags),
      lyricTimings: s.lyricTimings ? JSON.stringify(s.lyricTimings) : null,
      bpm: s.bpm,
      artSeed: s.artSeed || s.id,
      variationGroupId: s.variationGroupId || s.id,
    };
    const exists = db.select().from(schema.songs).where(eq(schema.songs.id, s.id)).get();
    if (exists) {
      db.update(schema.songs).set(row).where(eq(schema.songs.id, s.id)).run();
    } else {
      db.insert(schema.songs).values(row).run();
    }
    imported++;
  }
  return NextResponse.json({ imported, missingAudio });
}
