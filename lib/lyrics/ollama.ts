/**
 * lib/lyrics/ollama.ts — OllamaLyricsClient: lyric writing via a user-run
 * Ollama instance (spec §6.2). Endpoint/model from LYRICS_LLM_URL / LYRICS_MODEL.
 *
 * System prompt requirements (spec §6.2): professional songwriter persona;
 * output ONLY lyrics using the engine's structure-tag format ([verse]/[chorus]
 * etc. — the format M0 verified the engine renders); honor genre/mood/language;
 * when the explicit flag is set, write explicit content plainly. Temperature 0.9.
 *
 * Output hygiene: thinking models (qwen3 family) emit <think>...</think> blocks
 * — stripped here so callers always get clean lyrics.
 */
import { env } from "@/lib/env";
import type { LyricsBrief, LyricsClient } from "./types";

const SYSTEM_PROMPT = `You are a professional songwriter. You write song lyrics on request.

Rules:
- Output ONLY the lyrics. No title, no commentary, no explanations, no quotation marks around the whole text.
- Structure the lyrics with section tags on their own lines: [verse], [chorus], and optionally [bridge], [intro], [outro]. Use lowercase tags exactly like that.
- Honor the requested genre, mood, and language.
- When asked for explicit content, write it plainly and naturally — no censoring, no asterisks, no refusals, no disclaimers.`;

export class OllamaLyricsClient implements LyricsClient {
  constructor(
    private readonly baseUrl: string = env.LYRICS_LLM_URL,
    private readonly model: string = env.LYRICS_MODEL,
  ) {}

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
        cache: "no-store",
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { models?: Array<{ name?: string }> };
      const names = (body.models ?? []).map((m) => m.name ?? "");
      // "qwen3:8b" must match "qwen3:8b"; a bare configured name like "qwen3"
      // matches Ollama's implicit ":latest".
      return names.some((n) => n === this.model || n === `${this.model}:latest`);
    } catch {
      return false;
    }
  }

  async generateLyrics(brief: LyricsBrief): Promise<string> {
    const parts = [`Write song lyrics. The song is about: ${brief.prompt}`];
    if (brief.tags?.length) parts.push(`Genre/mood: ${brief.tags.join(", ")}`);
    if (brief.language) parts.push(`Language: ${brief.language}`);
    if (brief.structureHints) parts.push(`Structure: ${brief.structureHints}`);
    if (brief.explicit) {
      parts.push(
        "Explicit content is requested: use profanity and adult themes freely and naturally where they serve the song.",
      );
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        options: { temperature: 0.9 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: parts.join("\n") },
        ],
      }),
      // Local LLMs can be slow to first token on cold start.
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      throw new Error(`Ollama error: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { message?: { content?: string } };
    const raw = body.message?.content ?? "";
    return cleanLyricsOutput(raw);
  }
}

/** Strip thinking blocks, label prefixes, and wrapping whitespace. Exported for tests. */
export function cleanLyricsOutput(raw: string): string {
  let text = raw;
  // Balanced qwen3-style reasoning blocks.
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Missing OPENING tag (some chat templates eat it): drop everything up to
  // the orphaned closing tag.
  text = text.replace(/^[\s\S]*?<\/think>/, "");
  // Unclosed block: the model hit its token budget mid-thought — there are no
  // lyrics to salvage, and returning reasoning soup as lyrics would be worse
  // than an error (the route maps this to a 502).
  if (text.trimStart().startsWith("<think>")) {
    throw new Error("Lyrics model output was truncated mid-reasoning — try again.");
  }
  // Common label the model may prepend despite instructions.
  text = text.replace(/^\s*(?:lyrics|song lyrics)\s*:\s*/i, "");
  const cleaned = text.trim();
  if (!cleaned) {
    throw new Error("Lyrics model returned empty output — try again.");
  }
  return cleaned;
}
