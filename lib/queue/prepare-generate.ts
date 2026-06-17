/**
 * lib/queue/prepare-generate.ts — normalize a forge payload before engine I/O.
 *
 * Applies prompt/lyrics splitting, vocal-language detection, and Simple Mode
 * gating so runGenerate() sends one coherent GenerateRequest.
 */
import { resolveVocalLanguage } from "@/lib/lyrics/language";
import { splitPromptAndLyrics } from "@/lib/lyrics/split-prompt";

export interface GenerateForgeInput {
  prompt: string;
  lyrics: string;
  instrumental: boolean;
  vocalLanguage?: string;
}

export interface PreparedGenerateJob {
  prompt: string;
  lyrics: string;
  simpleMode: boolean;
  vocalLanguage: string | undefined;
  lockVocalLanguage: boolean;
  splitFromPrompt: boolean;
}

export function prepareGenerateJob(payload: GenerateForgeInput): PreparedGenerateJob {
  const split = splitPromptAndLyrics(payload.prompt, payload.lyrics);
  const lyrics = payload.instrumental ? "" : split.lyrics;
  const vocal = resolveVocalLanguage(payload.vocalLanguage, lyrics);

  return {
    prompt: split.prompt,
    lyrics,
    simpleMode: !payload.instrumental && !lyrics.trim(),
    vocalLanguage: vocal.language,
    lockVocalLanguage: vocal.lock,
    splitFromPrompt: split.split,
  };
}
