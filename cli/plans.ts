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

export interface UninstallLink {
  link: string;
  target: string;
}

export interface UninstallPlan {
  remove: string[];
  /** Symlinks. The link is removed. The folder it points at is not. */
  unlink: UninstallLink[];
  keep: string[];
  notes: string[];
}

export interface UninstallInspect {
  realpath(target: string): string;
  isSymlink(target: string): boolean;
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
  inspect?: UninstallInspect;
}): UninstallPlan {
  const candidates = [
    `${input.home}/.local/bin/wavesmith`,
    `${input.home}/Applications/Wavesmith.app`,
    `${input.home}/Library/LaunchAgents/com.wavesmith.login.plist`,
    input.stateDir,
  ];
  const keep = [`${input.root}/.env`];
  if (input.deleteData) candidates.push(input.dataDir);
  else keep.push(input.dataDir);
  if (input.deleteWeights) candidates.push(input.engineDir);
  else keep.push(input.engineDir);
  const remove: string[] = [];
  const unlink: UninstallLink[] = [];
  const notes: string[] = [];
  for (const candidate of candidates) {
    const placed = placePlannedPath(candidate, input.inspect);
    if (placed.unlink) {
      unlink.push(placed.unlink);
      notes.push(placed.note);
    } else {
      remove.push(placed.remove);
    }
  }
  return { remove, unlink, keep, notes };
}

/** A symlink stays a link in the plan. Its real path is named, and it is not a recursive delete. */
function placePlannedPath(
  candidate: string,
  inspect: UninstallInspect | undefined,
): { remove: string; unlink?: UninstallLink; note: string } {
  if (!inspect) return { remove: candidate, note: "" };
  let symlink = false;
  try {
    symlink = inspect.isSymlink(candidate);
  } catch {
    symlink = false;
  }
  if (!symlink) {
    try {
      return { remove: inspect.realpath(candidate), note: "" };
    } catch {
      return { remove: candidate, note: "" };
    }
  }
  let target = candidate;
  try {
    target = inspect.realpath(candidate);
  } catch {
    target = candidate;
  }
  return {
    remove: candidate,
    unlink: { link: candidate, target },
    note: `Unlinking ${candidate}. It points at ${target}, which stays.`,
  };
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
