/**
 * POST /api/lyrics — Generate Lyrics (spec §6.2/§9.2). Calls the LyricsClient
 * seam; 503 when the lyrics LLM is unavailable (the UI hides the button, but
 * a direct call still gets an honest answer).
 *
 * Calls are serialized via a module-level promise chain: the local LLM and the
 * engine LM share machine resources, and concurrent generations would contend.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getLyricsClient } from "@/lib/lyrics";

export const dynamic = "force-dynamic";

const LyricsSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2000),
    tags: z.array(z.string().max(40)).max(10).default([]),
    explicit: z.boolean().default(false),
    structureHints: z.string().max(200).optional(),
    language: z.string().max(30).optional(),
  })
  .strict();

let chain: Promise<unknown> = Promise.resolve();

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const parsed = LyricsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const client = getLyricsClient();
  if (!(await client.available())) {
    return NextResponse.json(
      { error: "Lyrics LLM unavailable — is Ollama running with the configured model?" },
      { status: 503 },
    );
  }

  const run = chain.then(() => client.generateLyrics(parsed.data));
  // Keep the chain alive even when a generation fails.
  chain = run.catch(() => undefined);
  try {
    const lyrics = await run;
    return NextResponse.json({ lyrics });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lyric generation failed" },
      { status: 502 },
    );
  }
}
