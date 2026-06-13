/**
 * lib/audio/ffmpeg.ts — server-side media tooling via the real ffmpeg binary
 * (Homebrew, spec §3). M4 uses it to encode MP3 downloads from the WAV master;
 * M5 reuses spawnFfmpeg for the stems ZIP path.
 *
 * MP3s are cached next to the master (<songDir>/take.mp3) so repeat downloads
 * are instant and survive restarts.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Run ffmpeg with the given args; resolve on exit 0, reject with stderr tail. */
export function spawnFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", "-loglevel", "error", ...args]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err) =>
      reject(new Error(`ffmpeg not available: ${err.message} (install via Homebrew)`)),
    );
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`)),
    );
  });
}

/**
 * Encode (or reuse a cached) 320k MP3 from a WAV master. Returns the absolute
 * mp3 path. Encodes to a .part file then renames — never leaves a truncated
 * mp3 in the cache if the process dies mid-encode.
 */
export async function ensureMp3(wavAbsPath: string): Promise<string> {
  const mp3Path = wavAbsPath.replace(/\.[^.]+$/, ".mp3");
  if (fs.existsSync(mp3Path) && fs.statSync(mp3Path).size > 0) return mp3Path;
  const tmp = `${mp3Path}.part-${process.pid}`;
  try {
    await spawnFfmpeg(["-i", wavAbsPath, "-codec:a", "libmp3lame", "-b:a", "320k", tmp]);
    fs.renameSync(tmp, mp3Path);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return mp3Path;
}

/** Suggest a filesystem-safe download filename from a song title. */
export function safeFilename(title: string, ext: string): string {
  const base = title
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "wavesmith-song";
  return `${base}.${ext}`;
}

/** Guard: keep cache paths inside the audio dir. */
export function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}
