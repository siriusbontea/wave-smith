/**
 * POST /api/songs/[id]/stems — enqueue a Demucs separation job (spec §7, M5).
 */
import { NextResponse } from "next/server";
import { demucsAvailable } from "@/lib/audio/demucs";
import { getSong } from "@/lib/songs/queries";
import { getQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getSong(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!demucsAvailable()) {
    return NextResponse.json(
      {
        error:
          "Demucs is not installed. Run ./scripts/setup.sh — stems need the demucs CLI on your machine.",
      },
      { status: 503 },
    );
  }
  const jobId = getQueue().enqueue("stems", { songId: id });
  return NextResponse.json({ jobId }, { status: 202 });
}
