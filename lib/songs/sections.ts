/**
 * lib/songs/sections.ts — lyric structure → a section timeline.
 *
 * ACE-Step's REST API does not return LRC (ENGINE_NOTES §7), so section
 * boundaries are estimated: split on [verse]/[chorus]/… tags (or "Verse 1:"
 * labels) and share the song duration by line count. A song with no tags
 * becomes one "Middle" window so a regenerate still leaves the intro and
 * ending untouched.
 */

export interface LyricSection {
  index: number;
  /** Short name shown in the editor ("Chorus", "Middle"). */
  label: string;
  /** Tag line to keep when rewriting, e.g. "[chorus]". Empty for the synthetic middle. */
  tag: string;
  /** Lines inside the section, without the tag. */
  body: string;
  startS: number;
  endS: number;
  /** True when the song had no structure tags and we invented a middle window. */
  synthetic: boolean;
}

/** Bracket tags, or "Verse 1:" / "Chorus:" labels. A bare lyric line like "Hook" is not a tag. */
const TAG_LINE =
  /^\s*(?:\[([^\]]+)\]|((?:verse|chorus|bridge|intro|outro|pre-chorus|prechorus|hook|break)(?:\s*\d+)?)\s*:)\s*$/i;

function titleCase(raw: string): string {
  const cleaned = raw.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Section";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

interface RawSection {
  tag: string;
  label: string;
  lines: string[];
}

function splitRaw(lyrics: string): RawSection[] {
  const lines = lyrics.replace(/\r\n/g, "\n").split("\n");
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  for (const line of lines) {
    const match = TAG_LINE.exec(line);
    if (match) {
      const inner = (match[1] ?? match[2] ?? "section").trim();
      const tag = `[${inner.toLowerCase()}]`;
      current = { tag, label: titleCase(inner), lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { tag: "", label: "Song", lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }
  return sections.filter((s) => s.tag || s.lines.some((l) => l.trim()));
}

function allocate(weights: number[], durationS: number): Array<{ startS: number; endS: number }> {
  const duration = Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
  const total = weights.reduce((sum, n) => sum + n, 0) || 1;
  let cursor = 0;
  return weights.map((weight, i) => {
    const startS = cursor;
    const endS = i === weights.length - 1 ? duration : cursor + (duration * weight) / total;
    cursor = endS;
    return { startS: roundTenth(startS), endS: roundTenth(endS) };
  });
}

function roundTenth(n: number): number {
  return Math.round(n * 10) / 10;
}

export function parseLyricSections(lyrics: string, durationS: number): LyricSection[] {
  const raw = splitRaw(lyrics);
  const tagged = raw.filter((s) => s.tag);
  if (tagged.length === 0) {
    const duration = Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
    const startS = roundTenth(duration * 0.2);
    const endS = roundTenth(Math.max(startS + 1, duration * 0.8));
    return [
      {
        index: 0,
        label: "Middle",
        tag: "",
        body: lyrics.trim(),
        startS,
        endS: Math.min(endS, roundTenth(duration)),
        synthetic: true,
      },
    ];
  }
  const weights = tagged.map((s) => Math.max(1, s.lines.filter((l) => l.trim()).length));
  const times = allocate(weights, durationS);
  return tagged.map((s, index) => ({
    index,
    label: s.label,
    tag: s.tag,
    body: s.lines.join("\n").trim(),
    startS: times[index]!.startS,
    endS: times[index]!.endS,
    synthetic: false,
  }));
}

/** Swap one section's body and rebuild the lyric text the engine will see. */
export function replaceSectionBody(lyrics: string, index: number, body: string): string {
  const sections = parseLyricSections(lyrics, 1);
  const target = sections[index];
  if (!target) return lyrics;
  if (target.synthetic) return body.trim();
  const next = sections.map((s, i) => (i === index ? { ...s, body: body.trim() } : s));
  return next
    .map((s) => (s.tag ? `${s.tag}\n${s.body}`.trimEnd() : s.body))
    .join("\n")
    .trim();
}

export interface EditWindow {
  start: number;
  end: number;
  target: number;
}

/** Clamp a client-proposed repaint range onto the real song duration. */
export function clampRepaintWindow(durationS: number, startS: number, endS: number): EditWindow | null {
  if (!Number.isFinite(durationS) || durationS <= 0) return null;
  const start = Math.max(0, Math.min(durationS, startS));
  const end = Math.max(0, Math.min(durationS, endS));
  if (end - start < 1) return null;
  return { start: roundTenth(start), end: roundTenth(end), target: roundTenth(durationS) };
}

/**
 * Continue past the end by repainting from 2s before the current ending
 * through duration+extend. The base-only `complete` task is not used.
 */
export function extendWindow(durationS: number, extendS: number): EditWindow | { error: string } {
  if (!Number.isFinite(durationS) || durationS <= 0) {
    return { error: "This song has no duration yet, so it can't be extended." };
  }
  if (extendS < 10 || extendS > 120) {
    return { error: "Extend by 10–120 seconds." };
  }
  const target = durationS + extendS;
  if (target > 600) {
    return { error: "That would pass the 10 minute limit. Pick a shorter extend." };
  }
  return {
    start: roundTenth(Math.max(0, durationS - 2)),
    end: roundTenth(target),
    target: roundTenth(target),
  };
}
