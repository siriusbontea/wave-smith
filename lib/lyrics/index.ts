/**
 * lib/lyrics/index.ts — LyricsClient factory: Ollama for real use, mock when
 * MOCK_ENGINE=1 (tests/demo mode get deterministic lyrics with no Ollama).
 */
import { env } from "@/lib/env";
import { MockLyricsClient } from "./mock";
import { OllamaLyricsClient } from "./ollama";
import type { LyricsClient } from "./types";

const globalForLyrics = globalThis as unknown as {
  __wavesmithLyrics?: LyricsClient;
};

export function getLyricsClient(): LyricsClient {
  if (!globalForLyrics.__wavesmithLyrics) {
    globalForLyrics.__wavesmithLyrics = env.MOCK_ENGINE
      ? new MockLyricsClient()
      : new OllamaLyricsClient();
  }
  return globalForLyrics.__wavesmithLyrics;
}

export * from "./types";
