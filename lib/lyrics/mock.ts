/**
 * lib/lyrics/mock.ts — MockLyricsClient: canned structured lyrics for tests
 * and demo mode (spec §6.2).
 */
import type { LyricsBrief, LyricsClient } from "./types";

export class MockLyricsClient implements LyricsClient {
  async available(): Promise<boolean> {
    return true;
  }

  async generateLyrics(brief: LyricsBrief): Promise<string> {
    return [
      "[verse]",
      `Walking through the story of ${brief.prompt.slice(0, 40)}`,
      "Every line a picture in my mind",
      "[chorus]",
      "Sing it back, sing it true",
      "Mock lyrics written just for you",
      "[verse]",
      "Second verse to carry on the theme",
      "Holding every color of the dream",
      "[chorus]",
      "Sing it back, sing it true",
      "Mock lyrics written just for you",
    ].join("\n");
  }
}
