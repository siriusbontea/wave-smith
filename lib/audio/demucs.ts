/**
 * lib/audio/demucs.ts — stem separation via the demucs CLI (spec §7).
 *
 * Runs `demucs -n htdemucs` on the song's master and collects four stems into
 * DATA_DIR/audio/<songId>/stems/. When MOCK_ENGINE=1 we copy the master into
 * four placeholder WAVs so tests stay fast without the demucs binary.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";
import { PARTS_SETUP } from "@/lib/setup-hints";

export { PARTS_SETUP };
export const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEM_NAMES)[number];

const DEMUCS_INSTALL_HINT =
  "The tool that splits a song into parts is not ready. Ask whoever set up Wavesmith to finish setup.";

let cachedDemucsBin: string | null | undefined;

/** Resolve the demucs executable. uv installs to ~/.local/bin, which GUI/minimal
 *  shells often omit from PATH — check common locations before giving up. */
export function resolveDemucsBin(): string | null {
  if (cachedDemucsBin !== undefined) return cachedDemucsBin;

  const candidates: string[] = [];
  if (env.DEMUCS_BIN) candidates.push(env.DEMUCS_BIN);

  const home = os.homedir();
  candidates.push(
    path.join(home, ".local/bin/demucs"),
    path.join(home, ".local/share/uv/tools/demucs/bin/demucs"),
  );

  if (process.env.PATH) {
    for (const dir of process.env.PATH.split(path.delimiter)) {
      if (dir) candidates.push(path.join(dir, "demucs"));
    }
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const st = fs.statSync(c);
        if (st.isFile() && (st.mode & 0o111) !== 0) {
          cachedDemucsBin = c;
          return c;
        }
      }
    } catch {
      /* next candidate */
    }
  }

  cachedDemucsBin = null;
  return null;
}

export function demucsAvailable(): boolean {
  return env.MOCK_ENGINE || resolveDemucsBin() !== null;
}

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
    // Keep the source extension. The demo clip is MP3; a .wav name would lie.
    const ext = path.extname(inputAbs).toLowerCase() || ".mp3";
    for (const name of STEM_NAMES) {
      const dest = path.join(stemsDir, `${name}${ext}`);
      fs.copyFileSync(inputAbs, dest);
    }
    onProgress?.(1, "Stems ready");
    return Object.fromEntries(STEM_NAMES.map((n) => [n, path.join(stemsDir, `${n}${ext}`)])) as Record<
      StemName,
      string
    >;
  }

  const workDir = path.join(stemsDir, "_demucs_out");
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  onProgress?.(0.1, "Splitting the song. This can take a few minutes.");
  await assertDemucsAudioIo();
  await runDemucs(inputAbs, workDir);
  onProgress?.(0.85, "Collecting stem files...");

  // demucs writes: <out>/htdemucs/<basename>/<stem>.wav
  const modelDir = path.join(workDir, "htdemucs");
  if (!fs.existsSync(modelDir)) {
    throw new Error(
      "Splitting the song did not produce any parts. Ask whoever set up Wavesmith to finish setup.",
    );
  }
  const trackDirs = fs.readdirSync(modelDir).map((d) => path.join(modelDir, d));
  const trackDir = trackDirs[0];
  if (!trackDir) {
    throw new Error("Splitting the song did not produce any parts. Ask whoever set up Wavesmith to finish setup.");
  }

  const out: Partial<Record<StemName, string>> = {};
  for (const name of STEM_NAMES) {
    const src = path.join(trackDir, `${name}.wav`);
    if (!fs.existsSync(src)) throw new Error(`A part is missing from the split (${name}).`);
    const dest = path.join(stemsDir, `${name}.wav`);
    fs.copyFileSync(src, dest);
    out[name] = dest;
  }

  fs.rmSync(workDir, { recursive: true, force: true });
  onProgress?.(1, "Stems ready");
  return out as Record<StemName, string>;
}

function resolveDemucsPython(bin: string): string {
  let resolved = bin;
  try {
    resolved = fs.realpathSync(bin);
  } catch {
    /* use bin as-is */
  }
  return path.join(path.dirname(resolved), "python3.12");
}

/** torchaudio 2.8 needs the soundfile backend to read/write WAV on macOS. */
function assertDemucsAudioIo(): Promise<void> {
  const bin = resolveDemucsBin();
  if (!bin) {
    return Promise.reject(new Error(`demucs not available — ${DEMUCS_INSTALL_HINT}`));
  }
  const py = resolveDemucsPython(bin);
  return new Promise((resolve, reject) => {
    const proc = spawn(
      py,
      [
        "-c",
        "import soundfile; import torchaudio; assert 'soundfile' in torchaudio.list_audio_backends()",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err) =>
      reject(new Error(`demucs Python not runnable: ${err.message} (${DEMUCS_INSTALL_HINT})`)),
    );
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `demucs is missing soundfile audio I/O (${stderr.trim() || "check failed"}) — ${DEMUCS_INSTALL_HINT}`,
            ),
          ),
    );
  });
}

function runDemucs(inputAbs: string, outDir: string): Promise<void> {
  const bin = resolveDemucsBin();
  if (!bin) {
    return Promise.reject(new Error(`demucs not available — ${DEMUCS_INSTALL_HINT}`));
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["-n", "htdemucs", "-o", outDir, inputAbs], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err) =>
      reject(new Error(`demucs not available: ${err.message} (${DEMUCS_INSTALL_HINT})`)),
    );
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`demucs exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}
