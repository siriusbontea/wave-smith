/**
 * lib/audio/basic-pitch.ts — approximate audio→MIDI via Spotify Basic Pitch (spec §14).
 *
 * Runs the `basic-pitch` CLI (ONNX backend on macOS — TensorFlow saved models break
 * on Py3.12). Output lands in DATA_DIR/audio/<songId>/midi/<source>.mid.
 * MOCK_ENGINE=1 copies public/demo-transcription.mid so tests stay fast.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";
import type { MIDI_SOURCES } from "@/db/schema";

export type MidiSource = (typeof MIDI_SOURCES)[number];

const INSTALL_HINT =
  'Run ./scripts/setup.sh — or: uv tool install --python 3.12 --with "setuptools<81" --with onnxruntime --with "scipy==1.11.4" "basic-pitch[onnx]"';

let cachedBin: string | null | undefined;

export function resolveBasicPitchBin(): string | null {
  if (cachedBin !== undefined) return cachedBin;

  const candidates: string[] = [];
  if (env.BASIC_PITCH_BIN) candidates.push(env.BASIC_PITCH_BIN);

  const home = os.homedir();
  candidates.push(
    path.join(home, ".local/bin/basic-pitch"),
    path.join(home, ".local/share/uv/tools/basic-pitch/bin/basic-pitch"),
  );

  if (process.env.PATH) {
    for (const dir of process.env.PATH.split(path.delimiter)) {
      if (dir) candidates.push(path.join(dir, "basic-pitch"));
    }
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const st = fs.statSync(c);
        if (st.isFile() && (st.mode & 0o111) !== 0) {
          cachedBin = c;
          return c;
        }
      }
    } catch {
      /* next */
    }
  }

  cachedBin = null;
  return null;
}

function resolveBasicPitchPython(bin: string): string {
  let resolved = bin;
  try {
    resolved = fs.realpathSync(bin);
  } catch {
    /* use bin */
  }
  return path.join(path.dirname(resolved), "python3.12");
}

/** ONNX + pinned scipy are required on this platform (verified M0). */
function assertBasicPitchRuntime(): Promise<void> {
  const bin = resolveBasicPitchBin();
  if (!bin) {
    return Promise.reject(new Error(`basic-pitch not available — ${INSTALL_HINT}`));
  }
  const py = resolveBasicPitchPython(bin);
  return new Promise((resolve, reject) => {
    const proc = spawn(
      py,
      [
        "-c",
        "import onnxruntime, scipy.signal; assert hasattr(scipy.signal,'gaussian'), 'pin scipy==1.11.4'",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err) =>
      reject(new Error(`basic-pitch Python not runnable: ${err.message} (${INSTALL_HINT})`)),
    );
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `basic-pitch runtime check failed (${stderr.trim() || "missing onnx/scipy pins"}) — ${INSTALL_HINT}`,
            ),
          ),
    );
  });
}

export function basicPitchAvailable(): boolean {
  return env.MOCK_ENGINE || resolveBasicPitchBin() !== null;
}

/** Transcribe one audio file to a canonical MIDI path for the given source. */
export async function transcribeToMidi(
  inputAbs: string,
  songId: string,
  source: MidiSource,
  onProgress?: (fraction: number, stage: string) => void,
): Promise<string> {
  const midiDir = path.join(env.audioDir, songId, "midi");
  fs.mkdirSync(midiDir, { recursive: true });
  const destAbs = path.join(midiDir, `${source}.mid`);

  if (env.MOCK_ENGINE) {
    onProgress?.(0.5, "Transcribing (mock)...");
    fs.copyFileSync(path.resolve("public/demo-transcription.mid"), destAbs);
    onProgress?.(1, "MIDI ready");
    return destAbs;
  }

  await assertBasicPitchRuntime();

  const workDir = path.join(midiDir, `_bp_out_${source}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  onProgress?.(0.15, "Loading Basic Pitch model (first run may take ~30s)...");
  await runBasicPitch(inputAbs, workDir, (line) => {
    if (line.includes("Predicting")) onProgress?.(0.35, "Analyzing audio…");
    else if (line.includes("Creating midi")) onProgress?.(0.75, "Writing MIDI notes…");
    else onProgress?.(0.5, "Transcribing (CPU)…");
  });
  onProgress?.(0.9, "Collecting MIDI file...");

  const produced = fs
    .readdirSync(workDir)
    .filter((f) => f.endsWith(".mid") || f.endsWith(".midi"))
    .map((f) => path.join(workDir, f));
  if (produced.length === 0) {
    throw new Error("basic-pitch produced no MIDI — try a shorter clip or a stem track");
  }
  fs.copyFileSync(produced[0]!, destAbs);
  fs.rmSync(workDir, { recursive: true, force: true });
  onProgress?.(1, "MIDI ready");
  return destAbs;
}

function runBasicPitch(
  inputAbs: string,
  outDir: string,
  onLine?: (line: string) => void,
): Promise<void> {
  const bin = resolveBasicPitchBin();
  if (!bin) {
    return Promise.reject(new Error(`basic-pitch not available — ${INSTALL_HINT}`));
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(
      bin,
      ["--model-serialization", "onnx", "--save-midi", outDir, inputAbs],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      for (const line of chunk.split("\n")) {
        const t = line.trim();
        if (t) onLine?.(t);
      }
    });
    proc.stdout.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      for (const line of chunk.split("\n")) {
        const t = line.trim();
        if (t) onLine?.(t);
      }
    });
    proc.on("error", (err) =>
      reject(new Error(`basic-pitch not available: ${err.message} (${INSTALL_HINT})`)),
    );
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`basic-pitch exited ${code}: ${stderr.slice(-600)}`)),
    );
  });
}
