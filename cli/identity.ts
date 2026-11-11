/**
 * cli/identity.ts — a pid is Wavesmith only when the command and the start time match.
 * A reused pid after reboot or exit has a different start time. That is stale.
 * Callers must not signal a stale pid.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";

export const SUPERVISOR_MARKER = "cli/main.ts";
export const ENGINE_MARKER = "acestep-api";
export const APP_MARKER = "next";

export interface ProcessIdentity {
  command: string;
  startedAt: string;
}

export function commandHasMarker(command: string, marker: string): boolean {
  if (marker === APP_MARKER) {
    return command.includes("next") && (command.includes("--hostname") || command.includes("next start"));
  }
  return command.includes(marker);
}

/** Both the recorded start time and the expected command must match. Either miss is stale. */
export function isOurProcess(input: {
  expectedStartedAt: string;
  marker: string;
  actual: ProcessIdentity | null;
}): boolean {
  if (!input.actual) return false;
  if (!input.expectedStartedAt) return false;
  if (input.actual.startedAt !== input.expectedStartedAt) return false;
  return commandHasMarker(input.actual.command, input.marker);
}

/** Field 22 of /proc/pid/stat, after the comm field which may contain spaces and parentheses. */
export function parseProcStatStart(stat: string): string | null {
  const end = stat.lastIndexOf(")");
  if (end < 0) return null;
  const fields = stat.slice(end + 2).trim().split(/\s+/);
  const ticks = fields[19];
  if (!ticks || !/^\d+$/.test(ticks)) return null;
  return ticks;
}

export function parseBtime(stat: string): string | null {
  const line = stat.split("\n").find((row) => row.startsWith("btime "));
  const value = line?.split(/\s+/)[1];
  if (!value || !/^\d+$/.test(value)) return null;
  return value;
}

/**
 * The same reader records the pid file and checks it later.
 * Linux uses boot time plus start ticks. macOS uses `ps` lstart.
 * Mixing the two formats would look like a mismatch, so a box with /proc never falls through to ps.
 */
export function readProcessIdentity(pid: number): ProcessIdentity | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (fs.existsSync("/proc/self/stat")) return readProcIdentity(pid);
  return readPsIdentity(pid);
}

function readProcIdentity(pid: number): ProcessIdentity | null {
  try {
    const command = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
    if (!command) return null;
    const ticks = parseProcStatStart(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
    const btime = parseBtime(fs.readFileSync("/proc/stat", "utf8"));
    if (!ticks || !btime) return null;
    return { command, startedAt: `${btime}:${ticks}` };
  } catch {
    return null;
  }
}

function readPsIdentity(pid: number): ProcessIdentity | null {
  const started = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  const command = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  if (started.status !== 0 || command.status !== 0) return null;
  const when = started.stdout.trim();
  const cmd = command.stdout.trim();
  if (!when || !cmd) return null;
  return { command: cmd, startedAt: when };
}
