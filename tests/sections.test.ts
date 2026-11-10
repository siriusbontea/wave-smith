import { describe, expect, it } from "vitest";
import { extendGrew, EXTEND_LENGTH_ERROR } from "@/lib/songs/extend-check";
import { mockTimings } from "@/lib/lyrics/timings";
import {
  clampRepaintWindow,
  extendWindow,
  parseLyricSections,
  replaceSectionBody,
  sectionsForTimeline,
} from "@/lib/songs/sections";

describe("lyric sections", () => {
  it("splits tags and shares duration by line count", () => {
    const lyrics = "[verse]\nOne\nTwo\n[chorus]\nHook";
    const sections = parseLyricSections(lyrics, 30);
    expect(sections.map((s) => s.label)).toEqual(["Verse", "Chorus"]);
    expect(sections[0]!.startS).toBe(0);
    expect(sections[1]!.endS).toBe(30);
    expect(sections[0]!.endS).toBeGreaterThan(sections[1]!.startS - 0.2);
    expect(sections[0]!.endS).toBeGreaterThan(sections[1]!.endS - sections[1]!.startS);
  });

  it("uses a middle window when there are no tags", () => {
    const [only] = parseLyricSections("just words", 20);
    expect(only!.synthetic).toBe(true);
    expect(only!.label).toBe("Middle");
    expect(only!.startS).toBe(4);
    expect(only!.endS).toBe(16);
  });

  it("replaces one section without dropping the others", () => {
    const next = replaceSectionBody("[verse]\nOld\n[chorus]\nHook", 1, "New hook");
    expect(next).toContain("[verse]");
    expect(next).toContain("Old");
    expect(next).toContain("New hook");
    expect(next).not.toContain("Hook");
  });

  it("rejects a repaint shorter than a second", () => {
    expect(clampRepaintWindow(30, 10, 10.2)).toBeNull();
    expect(clampRepaintWindow(30, 10, 12)?.end).toBe(12);
  });

  it("places an extend past the current ending", () => {
    const window = extendWindow(30, 15);
    expect(window).toEqual({ start: 28, end: 45, target: 45 });
  });

  it("uses stored line times instead of the line-count estimate", () => {
    const lyrics = "[verse]\nOne two\n[chorus]\nHook";
    const estimated = parseLyricSections(lyrics, 30);
    expect(estimated[1]!.startS).not.toBe(10);
    const timings = mockTimings(lyrics, 30);
    timings.lines[0] = { ...timings.lines[0]!, startS: 1, endS: 4, words: timings.lines[0]!.words };
    timings.lines[1] = { ...timings.lines[1]!, startS: 10, endS: 14, words: timings.lines[1]!.words };
    const timed = sectionsForTimeline(lyrics, 30, timings);
    expect(timed.source).toBe("mock");
    expect(timed.sections[1]!.startS).toBe(10);
    expect(timed.sections[1]!.endS).toBe(14);
    expect(timed.sections[1]!.lines?.[0]?.text).toBe("Hook");
  });

  it("falls back to tag estimates when timings do not match the lyrics", () => {
    const timings = mockTimings("[verse]\nSomething else entirely", 30);
    const timed = sectionsForTimeline("[verse]\nOne\n[chorus]\nHook", 30, timings);
    expect(timed.source).toBe("estimated");
  });
});

describe("extendGrew", () => {
  it("trusts the reported duration in demo mode", () => {
    expect(
      extendGrew({
        mockEngine: true,
        targetDurationS: 45,
        reportedDurationS: 45,
        probedDurationS: 10,
      }),
    ).toBe(true);
  });

  it("fails when a real file did not get longer", () => {
    expect(
      extendGrew({
        mockEngine: false,
        targetDurationS: 45,
        reportedDurationS: 45,
        probedDurationS: 30,
      }),
    ).toBe(false);
    expect(EXTEND_LENGTH_ERROR).toMatch(/not longer/);
  });
});
