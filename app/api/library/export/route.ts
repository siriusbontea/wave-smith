/**
 * GET /api/library/export — download the library as JSON (metadata only;
 * audio stays on disk, spec §9.3). Import restores these rows.
 */
import { NextResponse } from "next/server";
import { listSongs } from "@/lib/songs/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = {
    wavesmithLibrary: 1,
    songs: listSongs(),
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="wavesmith-library.json"`,
    },
  });
}
