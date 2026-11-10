/**
 * lib/audio/align.ts — local lyric alignment.
 *
 * ACE-Step can timestamp lyrics from generation latents, but only inside the
 * Gradio session (ENGINE_NOTES §7). Those tensors are not in the REST response
 * and are not stored with the song. This module forced-aligns the known lyric
 * text to the vocals stem (or the mix) with stable-ts, fully offline after the
 * Whisper weights are cached. MOCK_ENGINE skips the model and returns even
 * character-weighted times so the editor can be exercised without it.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";
import { mockTimings, parseAlignerPayload, type LyricTimings } from "@/lib/lyrics/timings";
import { ALIGNER_SETUP } from "@/lib/setup-hints";

export { ALIGNER_SETUP };

export const ALIGNER_MISSING =
  "Timing lyrics needs a setup step that is not finished. Ask whoever set up Wavesmith.";

export function resolveAlignPython(): string | null {
  const candidates: string[] = [];
  if (env.ALIGN_PYTHON) candidates.push(env.ALIGN_PYTHON);
  candidates.push(path.resolve(".venv-align/bin/python"));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* next */
    }
  }
  return null;
}

export function alignerAvailable(): boolean {
  return env.MOCK_ENGINE || resolveAlignPython() !== null;
}

export async function alignLyrics(input: {
  audioAbs: string;
  lyrics: string;
  language: string;
  durationS: number;
}): Promise<LyricTimings> {
  if (env.MOCK_ENGINE) return mockTimings(input.lyrics, input.durationS);

  const python = resolveAlignPython();
  if (!python) throw new Error(ALIGNER_MISSING);
  const script = path.resolve("scripts/align_lyrics.py");
  if (!fs.existsSync(script)) throw new Error("scripts/align_lyrics.py is missing.");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-align-"));
  const lyricsPath = path.join(dir, "lyrics.txt");
  fs.writeFileSync(lyricsPath, input.lyrics, "utf8");
  try {
    const stdout = await runAligner(python, script, input.audioAbs, lyricsPath, input.language);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error("The aligner returned something that was not JSON.");
    }
    const timings = parseAlignerPayload(parsed, input.durationS);
    if (!timings) {
      throw new Error("The aligner found no sung words in this audio. Section times stay estimated.");
    }
    return timings;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runAligner(
  python: string,
  script: string,
  audio: string,
  lyricsPath: string,
  language: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(python, [script, audio, lyricsPath, language], {
      env: { ...process.env, ALIGN_WHISPER_MODEL: env.ALIGN_WHISPER_MODEL },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Lyric alignment timed out after 20 minutes."));
    }, 20 * 60 * 1000);
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`${ALIGNER_MISSING} (${err.message})`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const detail = stderr.trim().split("\n").at(-1) ?? `exit ${code}`;
      reject(new Error(`Lyric alignment failed: ${detail}`));
    });
  });
}
