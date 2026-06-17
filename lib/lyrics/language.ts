/**
 * lib/lyrics/language.ts — vocal-language helpers for the engine seam.
 *
 * ACE-Step accepts one vocal_language code per forge (50 ISO-style codes +
 * "unknown"). Lyrics are wrapped as "# Languages\n{code}\n\n# Lyric\n…".
 * We detect script mix from user lyrics, resolve an engine code, and tell the
 * client when to disable use_cot_language so the LM does not override it.
 */
/** Mirrors ACE-Step VALID_LANGUAGES (ENGINE_NOTES §3, M0-verified). */
export const VOCAL_LANGUAGES = [
  "ar",
  "az",
  "bg",
  "bn",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "fa",
  "fi",
  "fr",
  "he",
  "hi",
  "hr",
  "ht",
  "hu",
  "id",
  "is",
  "it",
  "ja",
  "ko",
  "la",
  "lt",
  "ms",
  "ne",
  "nl",
  "no",
  "pa",
  "pl",
  "pt",
  "ro",
  "ru",
  "sa",
  "sk",
  "sr",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tl",
  "tr",
  "uk",
  "ur",
  "vi",
  "yue",
  "zh",
  "unknown",
] as const;

export type VocalLanguage = (typeof VOCAL_LANGUAGES)[number];

const VOCAL_LANGUAGE_SET = new Set<string>(VOCAL_LANGUAGES);

/** Plain-language aliases users might pass before the UI picker exists. */
const LANGUAGE_ALIASES: Record<string, VocalLanguage> = {
  english: "en",
  russian: "ru",
  spanish: "es",
  french: "fr",
  german: "de",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
  mandarin: "zh",
  cantonese: "yue",
  portuguese: "pt",
  italian: "it",
  arabic: "ar",
  hindi: "hi",
  ukrainian: "uk",
  mixed: "unknown",
  multilingual: "unknown",
  auto: "unknown",
};

/** Script → default engine code. Cyrillic defaults to ru (uk not distinguished). */
const SCRIPT_DETECTORS: Array<{ lang: VocalLanguage; test: RegExp }> = [
  { lang: "ru", test: /[\u0400-\u04FF]/ },
  { lang: "ar", test: /[\u0600-\u06FF]/ },
  { lang: "he", test: /[\u0590-\u05FF]/ },
  { lang: "ko", test: /[\uAC00-\uD7AF\u1100-\u11FF]/ },
  { lang: "ja", test: /[\u3040-\u30FF]/ },
  { lang: "zh", test: /[\u4E00-\u9FFF]/ },
  { lang: "th", test: /[\u0E00-\u0E7F]/ },
  { lang: "hi", test: /[\u0900-\u097F]/ },
  { lang: "el", test: /[\u0370-\u03FF]/ },
  { lang: "en", test: /[A-Za-z\u00C0-\u024F]/ },
];

/** Second script ≥ this share of letters ⇒ treat as mixed-language lyrics. */
const MIXED_SCRIPT_RATIO = 0.12;

export function isVocalLanguage(value: string): value is VocalLanguage {
  return VOCAL_LANGUAGE_SET.has(value);
}

export function normalizeVocalLanguage(raw: string | undefined): VocalLanguage | undefined {
  if (!raw?.trim()) return undefined;
  const key = raw.trim().toLowerCase();
  if (isVocalLanguage(key)) return key;
  return LANGUAGE_ALIASES[key];
}

export type LyricsLanguageDetection =
  | { kind: "none" }
  | { kind: "single"; language: VocalLanguage }
  | { kind: "mixed" };

/** Count letter-like characters per engine language via script heuristics. */
export function detectLyricsLanguage(lyrics: string): LyricsLanguageDetection {
  const text = lyrics.trim();
  if (!text) return { kind: "none" };

  const counts = new Map<VocalLanguage, number>();
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    for (const { lang, test } of SCRIPT_DETECTORS) {
      if (test.test(ch)) {
        counts.set(lang, (counts.get(lang) ?? 0) + 1);
        break;
      }
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return { kind: "none" };
  if (ranked.length === 1) return { kind: "single", language: ranked[0]![0] };

  const total = ranked.reduce((sum, [, n]) => sum + n, 0);
  const [, secondCount] = ranked[1]!;
  if (secondCount / total >= MIXED_SCRIPT_RATIO) return { kind: "mixed" };
  return { kind: "single", language: ranked[0]![0] };
}

export interface ResolvedVocalLanguage {
  language: VocalLanguage | undefined;
  /** When true, AceStepClient sends use_cot_language:false. */
  lock: boolean;
}

/**
 * Pick the engine vocal_language and whether to block LM CoT override.
 * Explicit user codes win; lyrics detection fills gaps; Simple Mode keeps
 * engine defaults when there is nothing to infer.
 */
export function resolveVocalLanguage(
  explicit: string | undefined,
  lyrics: string,
): ResolvedVocalLanguage {
  const normalized = normalizeVocalLanguage(explicit);
  if (normalized) {
    return { language: normalized, lock: true };
  }

  const detection = detectLyricsLanguage(lyrics);
  if (detection.kind === "mixed") {
    return { language: "unknown", lock: true };
  }
  if (detection.kind === "single") {
    return { language: detection.language, lock: true };
  }

  return { language: undefined, lock: false };
}
