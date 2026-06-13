/**
 * GET /api/songs — the library list (client-filtered). Returns every song
 * newest-first; the Library UI groups by variationGroupId and applies
 * search/tag/favorite filters client-side.
 */
import { NextResponse } from "next/server";
import { listSongs } from "@/lib/songs/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ songs: listSongs() });
}
