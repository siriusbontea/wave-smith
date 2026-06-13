/**
 * tests/cover.test.ts — deterministic cover art (spec §9.4 gate).
 */
import { describe, expect, it } from "vitest";
import { coverArt } from "@/lib/art/cover";

describe("coverArt", () => {
  it("is deterministic for the same seed", () => {
    const a = coverArt("song-abc-123");
    const b = coverArt("song-abc-123");
    expect(a).toEqual(b);
  });

  it("differs for different seeds", () => {
    const a = coverArt("seed-one");
    const b = coverArt("seed-two");
    expect(a.stops).not.toEqual(b.stops);
  });

  it("produces 2–3 gradient stops and 2–4 shapes", () => {
    const art = coverArt("test");
    expect(art.stops.length).toBeGreaterThanOrEqual(2);
    expect(art.stops.length).toBeLessThanOrEqual(3);
    expect(art.shapes.length).toBeGreaterThanOrEqual(2);
    expect(art.shapes.length).toBeLessThanOrEqual(4);
  });
});
