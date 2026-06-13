/**
 * lib/audio/demucs.ts — stem separation via the demucs CLI (spec §7).
 *
 * Runs `demucs -n htdemucs` on the song's master and collects four stems into
 * DATA_DIR/audio/<songId>/stems/. When MOCK_ENGINE=1 we copy the master into
 * four placeholder WAVs so tests stay fast without the demucs binary.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

export const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEM_NAMES)[number];

/** Run demucs and return absolute paths keyed by stem name. */
export async function separateStems(
  inputAbs: string,
  songId: string,
  onProgress?: (fraction: number, stage: string) => void,
): Promise<Record<StemName, string>> {
  const stemsDir = path.join(env.audioDir, songId, "stems");
  fs.mkdirSync(stemsDir, { recursive: true });

  if (env.MOCK_ENGINE) {
    onProgress?.(0.5, "Separating stems (mock)...");
    for (const name of STEM_NAMES) {
      const dest = path.join(stemsDir, `${name}.wav`);
      fs.copyFileSync(inputAbs, dest);
    }
    onProgress?.(1, "Stems ready");
    return Object.fromEntries(STEM_NAMES.map((n) => [n, path.join(stemsDir, `${n}.wav`)])) as Record<
      StemName,
      string
    >;
  }

  const workDir = path.join(stemsDir, "_demucs_out");
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  onProgress?.(0.1, "Starting Demucs (CPU — this may take a few minutes)...");
  await runDemucs(inputAbs, workDir);
  onProgress?.(0.85, "Collecting stem files...");

  // demucs writes: <out>/htdemucs/<basename>/<stem>.wav
  const modelDir = path.join(workDir, "htdemucs");
  if (!fs.existsSync(modelDir)) {
    throw new Error("Demucs produced no output — run scripts/setup.sh to install demucs");
  }
  const trackDirs = fs.readdirSync(modelDir).map((d) => path.join(modelDir, d));
  const trackDir = trackDirs[0];
  if (!trackDir) throw new Error("Demucs output directory is empty");

  const out: Partial<Record<StemName, string>> = {};
  for (const name of STEM_NAMES) {
    const src = path.join(trackDir, `${name}.wav`);
    if (!fs.existsSync(src)) throw new Error(`Demucs missing stem: ${name}`);
    const dest = path.join(stemsDir, `${name}.wav`);
    fs.copyFileSync(src, dest);
    out[name] = dest;
  }

  fs.rmSync(workDir, { recursive: true, force: true });
  onProgress?.(1, "Stems ready");
  return out as Record<StemName, string>;
}

function runDemucs(inputAbs: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("demucs", ["-n", "htdemucs", "-o", outDir, inputAbs], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err) =>
      reject(new Error(`demucs not available: ${err.message} (install via scripts/setup.sh)`)),
    );
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`demucs exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}
