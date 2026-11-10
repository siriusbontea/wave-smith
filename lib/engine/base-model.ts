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

function fileSize(abs: string): number {
  try {
    const stat = fs.statSync(abs);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

/** A weight shard counts only when it is a non-empty file in this directory. */
function shardReady(dir: string, name: string): boolean {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return false;
  return fileSize(path.join(dir, name)) > 0;
}

/**
 * An index counts only when it is non-empty JSON with a weight_map whose
 * shards are all present and non-empty. A zero-byte index is not "ready".
 */
function indexReady(dir: string, name: string): boolean {
  const abs = path.join(dir, name);
  if (fileSize(abs) <= 0) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as { weight_map?: unknown };
    if (!parsed.weight_map || typeof parsed.weight_map !== "object") return false;
    const shards = new Set(Object.values(parsed.weight_map as Record<string, unknown>));
    if (shards.size === 0) return false;
    return [...shards].every((shard) => typeof shard === "string" && shardReady(dir, shard));
  } catch {
    return false;
  }
}

/** True when the base checkpoint directory contains real, non-empty weight files. */
export function baseModelOnDisk(engineDir = env.ENGINE_DIR): boolean {
  const dir = baseCheckpointDir(engineDir);
  if (!fs.existsSync(dir)) return false;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return false;
  }
  for (const name of names) {
    const weight = name.endsWith(".safetensors") || name.endsWith(".bin");
    const index = name.endsWith(".index.json");
    if (weight && !index && fileSize(path.join(dir, name)) > 0) return true;
  }
  return names.some((name) => name.endsWith(".index.json") && indexReady(dir, name));
}
