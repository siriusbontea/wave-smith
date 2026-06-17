/**
 * Vocal-language detection, prompt/lyrics splitting, and forge preparation.
 */
import { describe, expect, it } from "vitest";
import {
  detectLyricsLanguage,
  normalizeVocalLanguage,
  resolveVocalLanguage,
} from "@/lib/lyrics/language";
import { splitPromptAndLyrics } from "@/lib/lyrics/split-prompt";
import { prepareGenerateJob } from "@/lib/queue/prepare-generate";

describe("detectLyricsLanguage", () => {
  it("detects English from Latin script", () => {
    expect(detectLyricsLanguage("[verse]\nUnder streetlight halos")).toEqual({
      kind: "single",
      language: "en",
    });
  });

  it("detects Russian from Cyrillic", () => {
    expect(detectLyricsLanguage("Ты мой волк, я твоя луна")).toEqual({
      kind: "single",
      language: "ru",
    });
  });

  it("flags mixed English + Cyrillic as mixed", () => {
    const lyrics = `[verse]
Howl with me through the static
[bridge]
Ты мой волк, я твоя луна`;
    expect(detectLyricsLanguage(lyrics)).toEqual({ kind: "mixed" });
  });
});

describe("resolveVocalLanguage", () => {
  it("honors explicit codes and aliases", () => {
    expect(resolveVocalLanguage("ru", "")).toEqual({ language: "ru", lock: true });
    expect(resolveVocalLanguage("Russian", "")).toEqual({ language: "ru", lock: true });
  });

  it("uses unknown for mixed lyrics when not explicit", () => {
    expect(resolveVocalLanguage(undefined, "Hello\nПривет")).toEqual({
      language: "unknown",
      lock: true,
    });
  });

  it("does not lock when there are no lyrics to infer from", () => {
    expect(resolveVocalLanguage(undefined, "")).toEqual({
      language: undefined,
      lock: false,
    });
  });
});

describe("normalizeVocalLanguage", () => {
  it("accepts engine codes", () => {
    expect(normalizeVocalLanguage("ja")).toBe("ja");
  });
});

describe("splitPromptAndLyrics", () => {
  it("leaves prompt untouched when lyrics are already provided", () => {
    expect(
      splitPromptAndLyrics("darkwave indie", "[verse]\nNeon"),
    ).toEqual({
      prompt: "darkwave indie",
      lyrics: "[verse]\nNeon",
      split: false,
    });
  });

  it("splits labeled sections out of an empty-lyrics prompt", () => {
    const prompt = `dreamy darkwave indie, 95 bpm
Title: Dominus
Verse 1:
Under streetlight halos
Chorus:
Howl with me
Bridge:
Ты мой волк`;

    const result = splitPromptAndLyrics(prompt, "");
    expect(result.split).toBe(true);
    expect(result.prompt).toContain("dreamy darkwave");
    expect(result.prompt).toContain("Title: Dominus");
    expect(result.lyrics).toMatch(/^Verse 1:/);
    expect(result.lyrics).toContain("Ты мой волк");
  });

  it("splits on [verse] tags", () => {
    const result = splitPromptAndLyrics("chill lo-fi\n[verse]\nSoft rain", "");
    expect(result.split).toBe(true);
    expect(result.prompt).toBe("chill lo-fi");
    expect(result.lyrics).toBe("[verse]\nSoft rain");
  });
});

describe("prepareGenerateJob", () => {
  it("disables Simple Mode when lyrics are split from the prompt", () => {
    const prepared = prepareGenerateJob({
      prompt: "darkwave mood\nVerse 1:\nNeon fog",
      lyrics: "",
      instrumental: false,
    });
    expect(prepared.splitFromPrompt).toBe(true);
    expect(prepared.simpleMode).toBe(false);
    expect(prepared.lyrics).toContain("Verse 1:");
    expect(prepared.lockVocalLanguage).toBe(true);
    expect(prepared.vocalLanguage).toBe("en");
  });

  it("locks unknown for mixed split lyrics", () => {
    const prepared = prepareGenerateJob({
      prompt: `dreamy track
Verse 1:
English line
Bridge:
Ты мой волк`,
      lyrics: "",
      instrumental: false,
    });
    expect(prepared.vocalLanguage).toBe("unknown");
    expect(prepared.lockVocalLanguage).toBe(true);
  });
});
