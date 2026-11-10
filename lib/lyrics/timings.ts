/**
 * lib/lyrics/timings.ts — word and line times stored on a song.
 *
 * The engine REST API does not return LRC (ENGINE_NOTES §7). A local aligner
 * writes this JSON; the editor falls back to tag estimates when it is missing
 * or no longer matches the lyric text.
 */

export interface WordTiming {
  text: string;
  startS: number;
  endS: number;
}

export interface LineTiming {
  text: string;
  startS: number;
  endS: number;
  words: WordTiming[];
}

export interface LyricTimings {
  /** "aligned" is the local Whisper aligner. "mock" is demo mode only. */
  source: "aligned" | "mock";
  lines: LineTiming[];
}

const TAG_LINE =
  /^\s*(?:\[([^\]]+)\]|((?:verse|chorus|bridge|intro|outro|pre-chorus|prechorus|hook|break)(?:\s*\d+)?)\s*:)\s*$/i;

function roundTenth(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Sung lines only. Structure tags are not timed. */
export function singableLines(lyrics: string): string[] {
  return lyrics
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !TAG_LINE.test(line));
}

function clampSpan(start: number, end: number, durationS: number): { startS: number; endS: number } {
  const duration = Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
  const startS = Math.max(0, Math.min(duration, start));
  const endS = Math.max(startS, Math.min(duration || end, end));
  return { startS: roundTenth(startS), endS: roundTenth(Math.max(endS, startS)) };
}

/** Even character-weighted times. Demo mode and tests use this; it is not alignment. */
export function mockTimings(lyrics: string, durationS: number): LyricTimings {
  const lines = singableLines(lyrics);
  const duration = Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
  if (lines.length === 0 || duration <= 0) return { source: "mock", lines: [] };
  const weights = lines.map((line) => Math.max(1, line.length));
  const total = weights.reduce((sum, n) => sum + n, 0);
  let cursor = 0;
  const timed = lines.map((line, index) => {
    const span = (duration * weights[index]!) / total;
    const start = cursor;
    const end = index === lines.length - 1 ? duration : cursor + span;
    cursor = end;
    const words = line.split(/\s+/).filter(Boolean);
    const wordSpan = (end - start) / Math.max(1, words.length);
    return {
      text: line,
      startS: roundTenth(start),
      endS: roundTenth(end),
      words: words.map((text, i) => ({
        text,
        startS: roundTenth(start + i * wordSpan),
        endS: roundTenth(i === words.length - 1 ? end : start + (i + 1) * wordSpan),
      })),
    };
  });
  return { source: "mock", lines: timed };
}

interface AlignerWord {
  text?: unknown;
  start?: unknown;
  end?: unknown;
}

interface AlignerLine {
  text?: unknown;
  words?: unknown;
}

/** Validate the aligner's stdout. Returns null when the payload is unusable. */
export function parseAlignerPayload(raw: unknown, durationS: number): LyricTimings | null {
  if (!raw || typeof raw !== "object") return null;
  const linesRaw = (raw as { lines?: unknown }).lines;
  if (!Array.isArray(linesRaw)) return null;
  const lines: LineTiming[] = [];
  for (const entry of linesRaw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as AlignerLine;
    const wordsRaw = Array.isArray(row.words) ? row.words : [];
    const words: WordTiming[] = [];
    for (const word of wordsRaw) {
      if (!word || typeof word !== "object") continue;
      const w = word as AlignerWord;
      const text = typeof w.text === "string" ? w.text.trim() : "";
      const start = typeof w.start === "number" ? w.start : Number(w.start);
      const end = typeof w.end === "number" ? w.end : Number(w.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
      const span = clampSpan(start, end, durationS);
      words.push({ text, startS: span.startS, endS: span.endS });
    }
    if (words.length === 0) continue;
    const text =
      typeof row.text === "string" && row.text.trim()
        ? row.text.trim()
        : words.map((w) => w.text).join(" ");
    lines.push({
      text,
      startS: words[0]!.startS,
      endS: words[words.length - 1]!.endS,
      words,
    });
  }
  if (lines.length === 0) return null;
  return { source: "aligned", lines };
}

function readSeconds(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Read timings written by the aligner job. Accepts start/end (aligner stdout) and startS/endS (stored). */
export function parseStoredTimings(raw: string | null | undefined): LyricTimings | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const source = (parsed as { source?: unknown }).source;
    if (source !== "aligned" && source !== "mock") return null;
    const linesRaw = (parsed as { lines?: unknown }).lines;
    if (!Array.isArray(linesRaw)) return null;
    const lines: LineTiming[] = [];
    for (const entry of linesRaw) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as {
        text?: unknown;
        startS?: unknown;
        endS?: unknown;
        words?: unknown;
      };
      const wordsRaw = Array.isArray(row.words) ? row.words : [];
      const words: WordTiming[] = [];
      for (const word of wordsRaw) {
        if (!word || typeof word !== "object") continue;
        const w = word as { text?: unknown; start?: unknown; end?: unknown; startS?: unknown; endS?: unknown };
        const text = typeof w.text === "string" ? w.text.trim() : "";
        const start = readSeconds(w.startS ?? w.start);
        const end = readSeconds(w.endS ?? w.end);
        if (!text || start == null || end == null) continue;
        words.push({ text, startS: roundTenth(start), endS: roundTenth(Math.max(start, end)) });
      }
      const text =
        typeof row.text === "string" && row.text.trim()
          ? row.text.trim()
          : words.map((w) => w.text).join(" ");
      if (!text) continue;
      const startS = readSeconds(row.startS) ?? words[0]?.startS ?? null;
      const endS = readSeconds(row.endS) ?? words[words.length - 1]?.endS ?? null;
      if (startS == null || endS == null) continue;
      lines.push({ text, startS: roundTenth(startS), endS: roundTenth(Math.max(startS, endS)), words });
    }
    if (lines.length === 0) return null;
    return { source, lines };
  } catch {
    return null;
  }
}

/** Standard LRC, one timestamp per sung line. */
export function timingsToLrc(timings: LyricTimings): string {
  return timings.lines
    .map((line) => `[${formatLrcStamp(line.startS)}]${line.text}`)
    .join("\n");
}

function formatLrcStamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remain = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remain.toFixed(2).padStart(5, "0")}`;
}
