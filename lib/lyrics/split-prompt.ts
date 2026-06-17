/**
 * lib/lyrics/split-prompt.ts — extract embedded lyrics from a Create prompt.
 *
 * Users often paste style + titled sections into the prompt box (Simple tab).
 * When the lyrics field is empty the queue would otherwise enable Simple Mode
 * and the engine LM invents new lyrics. This heuristic moves structured lyric
 * blocks into the lyrics payload so they pass through verbatim.
 */
export interface SplitPromptResult {
  prompt: string;
  lyrics: string;
  /** True when lyrical structure was peeled out of the prompt. */
  split: boolean;
}

const SECTION_TAG_RE =
  /^\[(verse|chorus|bridge|intro|outro|pre-chorus|hook|interlude)(\s+\d+)?\]/i;

const LABELED_SECTION_RE =
  /^(verse|chorus|bridge|intro|outro|pre-chorus|hook|interlude)(\s+\d+)?\s*:/i;

function isLyricSectionLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return SECTION_TAG_RE.test(trimmed) || LABELED_SECTION_RE.test(trimmed);
}

/**
 * If `lyrics` is empty and `prompt` contains section markers, split style from
 * sung text. Title:/Language: lines before the first section stay in the prompt.
 */
export function splitPromptAndLyrics(prompt: string, lyrics: string): SplitPromptResult {
  if (lyrics.trim()) {
    return { prompt: prompt.trim(), lyrics: lyrics.trim(), split: false };
  }

  const normalized = prompt.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isLyricSectionLine(lines[i]!)) {
      startIdx = i;
      break;
    }
  }

  if (startIdx < 0) {
    return { prompt: prompt.trim(), lyrics: "", split: false };
  }

  const stylePart = lines.slice(0, startIdx).join("\n").trim();
  const lyricsPart = lines.slice(startIdx).join("\n").trim();
  if (!lyricsPart) {
    return { prompt: prompt.trim(), lyrics: "", split: false };
  }

  return {
    prompt: stylePart || "Vocal track matching the provided lyrics",
    lyrics: lyricsPart,
    split: true,
  };
}
