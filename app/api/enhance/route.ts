/**
 * POST /api/enhance — the Advanced-tab Enhance button (spec §9.2).
 * M0 verified the engine LM's plan is fetchable as a distinct step
 * (/format_input), so this populates the Advanced fields for user editing
 * before forging. 503 when the engine LM is unavailable.
 *
 * Serialized like /api/lyrics: the engine's LLMHandler is shared and unqueued
 * (ENGINE_NOTES §3) — concurrent Enhance calls would contend.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEngineClient } from "@/lib/engine";
import { EngineLmUnavailableError, EngineOfflineError } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

const EnhanceSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2000),
    lyrics: z.string().max(10_000).default(""),
    durationS: z.number().min(10).max(600).optional(),
    bpm: z.number().int().min(30).max(300).optional(),
    keyScale: z.string().max(20).optional(),
    timeSignature: z.enum(["2", "3", "4", "6"]).optional(),
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
  const parsed = EnhanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const run = chain.then(() => getEngineClient().enhance(parsed.data));
  chain = run.catch(() => undefined);
  try {
    return NextResponse.json(await run);
  } catch (err) {
    if (err instanceof EngineLmUnavailableError) {
      return NextResponse.json(
        { error: "The engine's language model is not loaded yet — try again shortly." },
        { status: 503 },
      );
    }
    if (err instanceof EngineOfflineError) {
      return NextResponse.json(
        { error: "Engine offline — start it with scripts/dev.sh." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Enhance failed" },
      { status: 502 },
    );
  }
}
