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
  /** NUL-separated argv when it comes from the OS. A space-joined string is split on spaces. */
  command: string;
  startedAt: string;
  /** Real executable path. A renamed argv still has to be this binary. */
  executable?: string;
}

function splitArgv(command: string): string[] {
  const parts = command.includes("\0") ? command.split("\0") : command.split(/\s+/);
  return parts.filter((part) => part.length > 0);
}

/** An argv element is the marker itself or a path that ends at the marker. A longer string that merely contains it is not. */
export function argvHasExactPath(argv: readonly string[], marker: string): boolean {
  const suffix = `/${marker}`;
  const windows = `\\${marker}`;
  return argv.some((arg) => arg === marker || arg.endsWith(suffix) || arg.endsWith(windows));
}

export function commandHasMarker(command: string, marker: string): boolean {
  const argv = splitArgv(command);
  if (marker === APP_MARKER) {
    const hasNext = argvHasExactPath(argv, "next");
    return hasNext && (argv.includes("--hostname") || argv.includes("start"));
  }
  return argvHasExactPath(argv, marker);
}

function executableBasename(executable: string): string {
  const parts = executable.split(/[/\\]/);
  return parts[parts.length - 1] ?? executable;
}

const EXECUTABLES: Record<string, readonly string[]> = {
  [SUPERVISOR_MARKER]: ["node"],
  [ENGINE_MARKER]: ["uv", "python", "python3", "python3.12", "acestep-api"],
  [APP_MARKER]: ["node", "pnpm"],
};

export function executableMatches(executable: string, marker: string): boolean {
  const base = executableBasename(executable);
  return (EXECUTABLES[marker] ?? []).includes(base);
}

/** Both the recorded start time and an exact argv path must match. A renamed sleep does not. */
export function isOurProcess(input: {
  expectedStartedAt: string;
  marker: string;
  actual: ProcessIdentity | null;
}): boolean {
  if (!input.actual) return false;
  if (!input.expectedStartedAt) return false;
  if (input.actual.startedAt !== input.expectedStartedAt) return false;
  if (!commandHasMarker(input.actual.command, input.marker)) return false;
  if (input.actual.executable && !executableMatches(input.actual.executable, input.marker)) return false;
  return true;
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

/** macOS `sysctl kern.proc.pid` start time, as seconds.microseconds. Locale does not matter. */
export function parseKernProcStart(text: string): string | null {
  const at = text.indexOf("p_starttime");
  const source = at >= 0 ? text.slice(at) : text;
  const sec = source.match(/(?:tv_)?sec\s*=\s*(\d+)/)?.[1];
  if (!sec) return null;
  const usec = source.match(/(?:tv_)?usec\s*=\s*(\d+)/)?.[1] ?? "0";
  return `${sec}.${usec.padStart(6, "0").slice(0, 6)}`;
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
    const argv = fs.readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter((part) => part.length > 0);
    if (argv.length === 0) return null;
    const ticks = parseProcStatStart(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
    const btime = parseBtime(fs.readFileSync("/proc/stat", "utf8"));
    if (!ticks || !btime) return null;
    let executable = "";
    try {
      executable = fs.realpathSync(`/proc/${pid}/exe`);
    } catch {
      executable = "";
    }
    return { command: argv.join("\0"), startedAt: `${btime}:${ticks}`, executable };
  } catch {
    return null;
  }
}

function readPsIdentity(pid: number): ProcessIdentity | null {
  const env = { ...process.env, LC_ALL: "C", LANG: "C" };
  const sysctl = spawnSync("sysctl", ["-n", `kern.proc.pid.${pid}`], { encoding: "utf8", env });
  let startedAt = sysctl.status === 0 ? parseKernProcStart(sysctl.stdout || "") : null;
  if (!startedAt) {
    const started = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env });
    if (started.status !== 0) return null;
    startedAt = started.stdout.trim();
  }
  const command = spawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8", env });
  const comm = spawnSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8", env });
  if (!startedAt || command.status !== 0) return null;
  const cmd = command.stdout.trim();
  if (!cmd) return null;
  const listed = (comm.stdout || "").trim();
  const executable = realExecutable(pid, env) || listed;
  return { command: cmd, startedAt, executable };
}

/** macOS has no /proc/pid/exe. lsof's txt entry is the binary, not the name set with exec -a. */
function realExecutable(pid: number, env: NodeJS.ProcessEnv): string {
  const lsof = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "txt", "-Fn"], { encoding: "utf8", env });
  if (lsof.status !== 0 || !lsof.stdout) return "";
  const paths = lsof.stdout.split("\n").filter((line) => line.startsWith("n") && line.length > 1);
  return paths[paths.length - 1]?.slice(1) ?? "";
}
