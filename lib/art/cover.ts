/**
 * lib/art/cover.ts — deterministic procedural cover art (spec §9.4).
 *
 * Pure function: the same art_seed always produces the same art (unit-tested).
 * No image model, no randomness at render time — a seeded PRNG drives a
 * 2–3 colour gradient plus a few geometric overlay shapes, rendered as SVG by
 * components/cover-art.tsx. (SVG over canvas: deterministic, SSR-friendly,
 * scalable, and the palette/shape math here is what the spec asks to be
 * unit-tested — see docs/DECISIONS.md.)
 */

export interface CoverShape {
  kind: "circle" | "rect";
  /** Percentages of the viewBox (0–100). */
  x: number;
  y: number;
  size: number;
  rotate: number;
  hue: number;
  opacity: number;
}

export interface CoverArt {
  /** Gradient direction in degrees. */
  angle: number;
  /** 2–3 HSL gradient stops, darkest last (studio aesthetic). */
  stops: string[];
  shapes: CoverShape[];
}

/** FNV-1a over the seed string → uint32 PRNG seed (stable across runs). */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function coverArt(seed: string): CoverArt {
  const rng = mulberry32(hashSeed(seed));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;

  const baseHue = Math.floor(rng() * 360);
  // Analogous or complementary second hue for cohesion.
  const scheme = pick(["analogous", "complementary", "triad"] as const);
  const hue2 =
    scheme === "complementary"
      ? (baseHue + 180) % 360
      : scheme === "triad"
        ? (baseHue + 120) % 360
        : (baseHue + 30 + Math.floor(rng() * 30)) % 360;

  const sat = 55 + Math.floor(rng() * 25); // 55–80
  const threeStop = rng() > 0.5;
  const stops = [
    `hsl(${baseHue} ${sat}% ${28 + Math.floor(rng() * 12)}%)`,
    ...(threeStop ? [`hsl(${(baseHue + hue2) / 2} ${sat}% 22%)`] : []),
    `hsl(${hue2} ${sat}% ${10 + Math.floor(rng() * 8)}%)`, // darkest last
  ];

  const shapeCount = 2 + Math.floor(rng() * 3); // 2–4
  const shapes: CoverShape[] = Array.from({ length: shapeCount }, () => ({
    kind: pick(["circle", "rect"] as const),
    x: Math.floor(rng() * 100),
    y: Math.floor(rng() * 100),
    size: 20 + Math.floor(rng() * 45),
    rotate: Math.floor(rng() * 90),
    hue: pick([baseHue, hue2]),
    opacity: 0.06 + rng() * 0.12,
  }));

  return { angle: Math.floor(rng() * 360), stops, shapes };
}
