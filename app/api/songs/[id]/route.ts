/**
 * GET    /api/songs/[id] — one song.
 * PATCH  /api/songs/[id] — edit metadata / favorite (spec §9.3).
 * DELETE /api/songs/[id] — remove row + on-disk audio (confirm is UI-side).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteSong, getSongDetail, updateSong } from "@/lib/songs/queries";

export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    lyrics: z.string().max(10_000).nullable().optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
    bpm: z.number().int().min(30).max(300).nullable().optional(),
    keyScale: z.string().max(20).nullable().optional(),
    timeSignature: z.enum(["2", "3", "4", "6"]).nullable().optional(),
    favorite: z.boolean().optional(),
  })
  .strict();

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const song = getSongDetail(id);
  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(song);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getSongDetail(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json(updateSong(id, parsed.data));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = deleteSong(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
