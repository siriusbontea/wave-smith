/**
 * lib/grok/subscription.ts — lyric plan through the user's Grok subscription.
 *
 * This is not the API-key hybrid. A missing CLI, a signed-out CLI, or any
 * other failure is returned to the lyrics route, which may fall back to the
 * local writer. It does not call xAI with XAI_API_KEY.
 */
import os from "node:os";
import { GrokBuildError, runGrokBuild, type GrokBuildOutput } from "@/cli/grok-build.ts";
import { buildGrokMessages, parseGrokPlan, type SongPlan } from "@/lib/grok/plan";
import { recordGrokUsage } from "@/lib/grok/usage";
import type { LyricsBrief } from "@/lib/lyrics/types";

export async function planWithGrokSubscription(brief: LyricsBrief): Promise<SongPlan> {
  const messages = buildGrokMessages(brief);
  const system = messages[0]?.content ?? "";
  const prompt = messages[1]?.content ?? brief.prompt;
  const model = process.env.GROK_BUILD_MODEL?.trim() || undefined;
  const output = await runGrokBuild({
    prompt,
    systemPrompt: system,
    model,
    home: process.env.HOME?.trim() || os.homedir(),
    configuredPath: process.env.GROK_BIN?.trim() || undefined,
  });
  recordGrokUsage(usageFrom(output));
  return parseGrokPlan(output.text);
}

function usageFrom(output: GrokBuildOutput) {
  return {
    model: output.model,
    inputTokens: output.inputTokens,
    outputTokens: output.outputTokens,
    reasoningTokens: output.reasoningTokens,
    totalTokens: output.totalTokens,
    costUsd: output.costUsd,
  };
}

export function friendlySubscriptionError(err: unknown, willFallback: boolean): string {
  const tail = willFallback
    ? " Using the local writer instead."
    : " The local lyrics writer isn't running — write the words yourself, or start Ollama.";
  if (err instanceof GrokBuildError) {
    if (err.kind === "unauthenticated") {
      return `Grok Build is not signed in. Open Terminal and run \`grok login\`.${tail}`;
    }
    if (err.kind === "missing") {
      return `Grok Build CLI was not found. Install it, then open Terminal and run \`grok login\`.${tail}`;
    }
    return `${err.message}${tail}`;
  }
  const message = err instanceof Error ? err.message : "";
  if (/declined|didn't return structured lyrics|empty reply/i.test(message)) {
    return `Grok Build didn't return lyrics.${tail}`;
  }
  return `Grok Build didn't answer.${tail}`;
}
