/**
 * POST /api/generate — the Forge endpoint. Validates the request (zod),
 * enqueues a generate job, returns { jobId } immediately. Progress is observed
 * via GET /api/jobs (1s polling, spec §3).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

const GenerateSchema = z
  .object({
    prompt: z.string().trim().min(1, "Describe the song you want").max(2000),
    lyrics: z.string().max(10_000).default(""),
    instrumental: z.boolean().default(false),
    durationS: z.number().min(10).max(600).optional(),
    bpm: z.number().int().min(30).max(300).optional(),
    keyScale: z.string().max(20).optional(),
    timeSignature: z.enum(["2", "3", "4", "6"]).optional(),
    vocalLanguage: z.string().max(10).optional(),
    variations: z.number().int().min(1).max(4).default(2),
    seed: z.number().int().min(0).max(0xffffffff).optional(),
  })
  .strict();

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const parsed = GenerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const jobId = getQueue().enqueue("generate", parsed.data);
  return NextResponse.json({ jobId }, { status: 202 });
}
