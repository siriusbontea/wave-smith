/**
 * cli/plans.ts — update and uninstall stay away from songs unless asked.
 * .env is never deleted. The model download is deleted only with an explicit yes.
 * data/ and engine/ follow DATA_DIR and ENGINE_DIR. The checkout itself stays,
 * because those folders live inside it.
 */

import { loadEnvFile } from "./envfile.ts";

export function updateCommands(): string[][] {
  return [
    ["git", "pull", "--ff-only"],
    ["pnpm", "install"],
    ["pnpm", "db:migrate"],
    ["pnpm", "build"],
  ];
}

export interface UninstallPlan {
  remove: string[];
  keep: string[];
}

export function resolveConfiguredDir(
  root: string,
  envText: string | null,
  key: string,
  fallback: string,
  processEnv: Record<string, string | undefined>,
): string {
  const fromProcess = processEnv[key]?.trim();
  const fromFile = envText ? loadEnvFile(envText)[key]?.trim() : undefined;
  const raw = fromProcess || fromFile || fallback;
  if (raw.startsWith("/")) return raw;
  return `${root}/${raw.replace(/^\.\//, "")}`;
}

export function planUninstall(input: {
  root: string;
  home: string;
  stateDir: string;
  deleteData: boolean;
  deleteWeights: boolean;
  dataDir: string;
  engineDir: string;
}): UninstallPlan {
  const remove = [
    `${input.home}/.local/bin/wavesmith`,
    `${input.home}/Applications/Wavesmith.app`,
    `${input.home}/Library/LaunchAgents/com.wavesmith.login.plist`,
    input.stateDir,
  ];
  const keep = [`${input.root}/.env`];
  if (input.deleteData) remove.push(input.dataDir);
  else keep.push(input.dataDir);
  if (input.deleteWeights) remove.push(input.engineDir);
  else keep.push(input.engineDir);
  return { remove, keep };
}

/** Drop the installer's PATH lines and leave the rest of the profile alone. */
export function stripWavesmithPath(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === "# Wavesmith") {
      const next = lines[i + 1] ?? "";
      if (next.includes(".local/bin") && next.includes("PATH")) i += 1;
      continue;
    }
    out.push(lines[i] ?? "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function lastLines(text: string, count: number): string {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
}
