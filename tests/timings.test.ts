import { describe, expect, it } from "vitest";
import { lyricTokens, mockTimings, parseAlignerPayload, parseStoredTimings, timingsToLrc } from "@/lib/lyrics/timings";

describe("lyric timings", () => {
  it("round-trips stored mock timings, including word startS", () => {
    const lyrics = "[verse]\nCity lights\n[chorus]\nHold the line";
    const stored = JSON.stringify(mockTimings(lyrics, 10));
    const parsed = parseStoredTimings(stored);
    expect(parsed?.source).toBe("mock");
    expect(parsed?.lines.map((line) => line.text)).toEqual(["City lights", "Hold the line"]);
    expect(parsed?.lines[1]?.words.map((word) => word.text)).toEqual(["Hold", "the", "line"]);
    expect(parsed?.lines[0]?.startS).toBe(0);
    expect(timingsToLrc(parsed!)).toMatch(/\[00:00\.00\]City lights/);
  });

  it("accepts aligner stdout that uses start and end", () => {
    const parsed = parseAlignerPayload(
      {
        lines: [
          {
            text: "Hold the line",
            words: [
              { text: "Hold", start: 1.2, end: 1.5 },
              { text: "the", start: 1.5, end: 1.7 },
              { text: "line", start: 1.7, end: 2.1 },
            ],
          },
        ],
      },
      10,
    );
    expect(parsed?.source).toBe("aligned");
    expect(parsed?.lines[0]?.words[0]).toEqual({ text: "Hold", startS: 1.2, endS: 1.5 });
  });

  it("splits a Japanese line into more than one token", () => {
    const tokens = lyricTokens("さくらがさいた");
    expect(tokens.length).toBeGreaterThan(1);
  });
});
