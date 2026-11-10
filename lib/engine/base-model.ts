/**
 * lib/engine/base-model.ts — where the base DiT lives on disk.
 *
 * Extend uses acestep-v15-base. Turbo stays the default forge model. The
 * weights are a separate Hugging Face download (setup.sh); a missing folder
 * must fail before we ask the engine to fetch multi-GB files mid-job.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

export const TURBO_DIT_MODEL = "acestep-v15-turbo";
export const BASE_DIT_MODEL = "acestep-v15-base";
/** Model card step count for base (CFG). Turbo forges stay at the engine default of 8. */
export const BASE_INFERENCE_STEPS = 50;
export const BASE_GUIDANCE_SCALE = 7;

export const BASE_MODEL_MISSING =
  "Extend needs the ACE-Step base model (acestep-v15-base), and those weights are not on disk. " +
  "Run ./scripts/setup.sh, or from the engine directory: uv run acestep-download -m acestep-v15-base. " +
  "New songs still use turbo.";

export function baseCheckpointDir(engineDir = env.ENGINE_DIR): string {
  return path.resolve(engineDir, "checkpoints", BASE_DIT_MODEL);
}

/** True when the base checkpoint directory contains real weight files. */
export function baseModelOnDisk(engineDir = env.ENGINE_DIR): boolean {
  const dir = baseCheckpointDir(engineDir);
  if (!fs.existsSync(dir)) return false;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return false;
  }
  return names.some(
    (name) =>
      name.endsWith(".safetensors") ||
      name.endsWith(".bin") ||
      name.endsWith(".index.json") ||
      name === "model.safetensors.index.json",
  );
}
