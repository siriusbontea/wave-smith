/**
 * lib/songs/sections.ts — lyric structure → a section timeline.
 *
 * ACE-Step's REST API does not return LRC (ENGINE_NOTES §7). When a local
 * alignment is stored, section cuts use those line times. Otherwise boundaries
 * are estimated: split on [verse]/[chorus]/… tags (or "Verse 1:" labels) and
 * share the song duration by line count. A song with no tags becomes one
 * "Middle" window so a regenerate still leaves the intro and ending untouched.
 */
import type { LineTiming, LyricTimings } from "@/lib/lyrics/timings";

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
  /** Sung lines inside this section, present when timings were applied. */
  lines?: LineTiming[];
}

export type SectionTimingSource = "aligned" | "mock" | "estimated";

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
 * Target length for an extend. The queue pads the source by (target - duration)
 * and runs the base model's complete task. See ENGINE_NOTES.
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

function sungLines(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !TAG_LINE.test(line));
}

function normalizeLine(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prefer stored line times for section cuts. Falls back to tag estimates when
 * the timings are missing or no longer line up with the lyric text.
 */
export function sectionsForTimeline(
  lyrics: string,
  durationS: number,
  timings: LyricTimings | null,
): { sections: LyricSection[]; source: SectionTimingSource } {
  const estimated = parseLyricSections(lyrics, durationS);
  if (!timings || timings.lines.length === 0) {
    return { sections: estimated, source: "estimated" };
  }
  // Same lines the estimator kept. A preamble before the first tag is not its own section.
  const expected = estimated.flatMap((section) => sungLines(section.body));
  if (expected.length === 0) return { sections: estimated, source: "estimated" };

  const paired = pairLines(expected, timings.lines);
  if (paired.filter(Boolean).length < Math.ceil(expected.length / 2)) {
    return { sections: estimated, source: "estimated" };
  }

  if (estimated.length === 1 && estimated[0]!.synthetic) {
    const used = paired.filter((line): line is LineTiming => line != null);
    const startS = used[0]!.startS;
    const endS = Math.max(startS + 1, used[used.length - 1]!.endS);
    return {
      source: timings.source,
      sections: [
        {
          ...estimated[0]!,
          startS: roundTenth(startS),
          endS: roundTenth(Math.min(endS, durationS > 0 ? durationS : endS)),
          lines: used,
        },
      ],
    };
  }

  let cursor = 0;
  const sections = estimated.map((section) => {
    const count = sungLines(section.body).length;
    const slice = paired.slice(cursor, cursor + count);
    cursor += count;
    const used = slice.filter((line): line is LineTiming => line != null);
    if (used.length === 0) return section;
    const startS = used[0]!.startS;
    const endS = Math.max(startS + 0.5, used[used.length - 1]!.endS);
    return {
      ...section,
      startS: roundTenth(startS),
      endS: roundTenth(endS),
      lines: used,
    };
  });
  return { sections, source: timings.source };
}

/** Zip by index when the line counts match; otherwise match normalized text in order. */
function pairLines(expected: string[], timed: LineTiming[]): Array<LineTiming | null> {
  if (expected.length === timed.length) return timed.slice();
  const out: Array<LineTiming | null> = [];
  let j = 0;
  for (const line of expected) {
    const want = normalizeLine(line);
    let found: LineTiming | null = null;
    while (j < timed.length) {
      const candidate = timed[j]!;
      j += 1;
      if (normalizeLine(candidate.text) === want) {
        found = candidate;
        break;
      }
    }
    out.push(found);
  }
  return out;
}
