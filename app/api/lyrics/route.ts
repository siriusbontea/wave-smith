/**
 * POST /api/lyrics — write lyrics (and, in Grok hybrid, a song plan).
 *
 * Local only is the default: Ollama when it is running, otherwise 503.
 * Grok hybrid calls xAI with an API key. Grok subscription calls the local
 * Grok Build CLI. Either one falls back to the local writer on failure, and
 * subscription never uses the API key. Unrestricted mode calls neither.
 * This route does not filter lyric text on the local path.
 *
 * Calls are serialized: the local LLM and the engine LM share the machine.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { GrokClient } from "@/lib/grok/client";
import { grokAllowed, subscriptionAllowed, getConnectionMode, getLyricsPolicy } from "@/lib/grok/mode";
import { friendlyGrokError } from "@/lib/grok/plan";
import { readGrokApiKey } from "@/lib/grok/secrets";
import { friendlySubscriptionError, planWithGrokSubscription } from "@/lib/grok/subscription";
import { getLyricsClient } from "@/lib/lyrics";
import type { LyricsBrief } from "@/lib/lyrics/types";

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

  const brief: LyricsBrief = parsed.data;
  const run = chain.then(() => writeLyrics(brief));
  chain = run.catch(() => undefined);
  try {
    return NextResponse.json(await run);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lyric generation failed";
    const status = /isn't running|isn't configured|no API key|Unrestricted/.test(message) ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

async function writeLyrics(brief: LyricsBrief) {
  const local = getLyricsClient();
  const mode = getConnectionMode();
  const unrestrictedSkip = (mode === "grok" || mode === "grok-subscription") && getLyricsPolicy() === "unrestricted";

  if (subscriptionAllowed()) {
    try {
      const plan = await planWithGrokSubscription(brief);
      return {
        lyrics: plan.lyrics,
        source: "grok-subscription" as const,
        notice: null,
        plan,
      };
    } catch (err) {
      if (await local.available()) {
        const lyrics = await local.generateLyrics(brief);
        return {
          lyrics,
          source: "local" as const,
          notice: friendlySubscriptionError(err, true),
          plan: null,
        };
      }
      throw new Error(friendlySubscriptionError(err, false));
    }
  }

  if (grokAllowed()) {
    if (!readGrokApiKey().key) {
      if (await local.available()) {
        const lyrics = await local.generateLyrics(brief);
        return {
          lyrics,
          source: "local" as const,
          notice: "Grok hybrid is on, but no API key is set. Wrote lyrics locally instead.",
          plan: null,
        };
      }
      throw new Error(
        "Grok hybrid is on, but no API key is set. The local lyrics writer isn't running — write the words yourself, switch to Local only, or add a key in Settings.",
      );
    }

    try {
      const plan = await new GrokClient().planLyrics(brief);
      return {
        lyrics: plan.lyrics,
        source: "grok" as const,
        notice: null,
        plan,
      };
    } catch (err) {
      if (await local.available()) {
        const lyrics = await local.generateLyrics(brief);
        return {
          lyrics,
          source: "local" as const,
          notice: friendlyGrokError(err, true),
          plan: null,
        };
      }
      throw new Error(friendlyGrokError(err, false));
    }
  }

  if (!(await local.available())) {
    if (unrestrictedSkip) {
      throw new Error(
        "Unrestricted lyrics keeps Grok off, and the local lyrics writer isn't running. Write the words yourself, or turn unrestricted off.",
      );
    }
    throw new Error("Lyrics LLM unavailable — is Ollama running with the configured model?");
  }

  const lyrics = await local.generateLyrics(brief);
  return {
    lyrics,
    source: "local" as const,
    notice: unrestrictedSkip
      ? "Unrestricted lyrics stays on this machine — Grok is not used."
      : null,
    plan: null,
  };
}
