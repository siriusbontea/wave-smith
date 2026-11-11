/**
 * cli/paths.ts — where the checkout and the pid file live.
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot(metaUrl: string, env: Record<string, string | undefined>): string {
  if (env.WAVESMITH_ROOT) return path.resolve(env.WAVESMITH_ROOT);
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), "..");
}

export function stateDirectory(input: {
  env: Record<string, string | undefined>;
  home: string;
  platform: string;
}): string {
  if (input.env.WAVESMITH_STATE_DIR) return path.resolve(input.env.WAVESMITH_STATE_DIR);
  if (input.platform === "darwin") return path.join(input.home, "Library", "Application Support", "Wavesmith");
  const base = input.env.XDG_STATE_HOME || path.join(input.home, ".local", "state");
  return path.join(base, "wavesmith");
}

export function homeDir(): string {
  return os.homedir();
}
