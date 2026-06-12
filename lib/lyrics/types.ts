/**
 * lib/lyrics/types.ts — the LyricsClient seam (spec §6.2).
 *
 * Wavesmith applies NO content filtering to lyrics — explicit language is the
 * user's call, like in any DAW. M0 found the engine's built-in planner is not
 * censored in practice either; this seam exists primarily for lyric QUALITY
 * (a dedicated local writer beats the 1.7B music-planner at craft) and stays
 * fully optional: when available() is false the Generate Lyrics button hides
 * and nothing else changes.
 */

export interface LyricsBrief {
  /** What the song is about / the vibe (usually the Create-page prompt). */
  prompt: string;
  /** Genre/mood tags to honor. */
  tags?: string[];
  /** Write explicit content plainly — no censoring, asterisks, or disclaimers. */
  explicit?: boolean;
  /** Structure hints, e.g. "verse-chorus-verse-chorus-bridge-chorus". */
  structureHints?: string;
  /** Lyric language (engine vocal_language code or plain name). */
  language?: string;
}

export interface LyricsClient {
  /** Endpoint reachable AND the configured model is pulled? */
  available(): Promise<boolean>;
  /** Returns lyrics formatted with the engine's structure tags ([verse], [chorus], ...). */
  generateLyrics(brief: LyricsBrief): Promise<string>;
}
