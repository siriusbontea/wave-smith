/**
 * GET /api/jobs — recent jobs for the queue strip and completion toasts.
 * Returns the newest 50 with live stage text merged from the queue's
 * in-memory map (stage is ephemeral; progress is persistent).
 */
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function GET() {
  const queue = getQueue(); // also triggers boot recovery on first hit
  const rows = db
    .select()
    .from(schema.jobs)
    .orderBy(desc(schema.jobs.createdAt))
    .limit(50)
    .all();

  const jobs = rows.map((row) => {
    // One corrupt result row must not 500 the whole queue strip.
    let result: unknown = null;
    try {
      result = row.result ? JSON.parse(row.result) : null;
    } catch {
      console.warn(`[jobs] unparseable result on job ${row.id}`);
    }
    let midiSource: string | null = null;
    let editKind: "repaint" | "extend" | null = null;
    let label =
      row.type === "stems" ? "Parts" : row.type === "midi" ? "Notes" : row.type === "align" ? "Lyrics" : "Song";
    try {
      const payload = JSON.parse(row.payload) as {
        source?: string;
        edit?: { kind?: string };
      };
      if (row.type === "midi") midiSource = payload.source ?? null;
      if (payload.edit?.kind === "repaint") {
        editKind = "repaint";
        label = "Section";
      } else if (payload.edit?.kind === "extend") {
        editKind = "extend";
        label = "Longer";
      }
    } catch {
      midiSource = null;
    }
    return {
      id: row.id,
      type: row.type,
      label,
      editKind,
      status: row.status,
      progress: row.progress,
      stage: queue.stages.get(row.id) ?? null,
      error: row.error,
      songId: row.songId,
      midiSource,
      result,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    };
  });
  return NextResponse.json({ jobs });
}
