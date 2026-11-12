/**
 * cli/grok-build.ts — run the signed-in Grok Build CLI for lyric drafts.
 *
 * The binary is an absolute path and an argv array. A shell is never used,
 * so a zsh `grok` function cannot add flags. Tools stay off. Each call gets
 * a fresh 0700 temp directory and a minimal environment. Wavesmith does not
 * read ~/.grok/auth.json; the CLI does that itself when HOME is set.
 *
 * grok 1.0.77 has no file flag for the system prompt, so that string is
 * capped and passed as one argv element. Stdout may have a banner before
 * the JSON; the last complete top-level object is the reply.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { recordGrokUsageFile } from "./grok-usage.ts";

export const STDOUT_CAP_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 120_000;
/** grok 1.0.77 has no --system-prompt file flag. This stays under ARG_MAX. */
export const SYSTEM_PROMPT_MAX_CHARS = 32 * 1024;

const UsageSchema = z
  .object({
    input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    reasoning_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  })
  .passthrough();

const ResultSchema = z
  .object({
    text: z.string(),
    stopReason: z.string(),
    usage: UsageSchema.optional(),
    total_cost_usd: z.number().optional(),
    modelUsage: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type GrokBuildKind = "missing" | "unauthenticated" | "timeout" | "output" | "protocol" | "exit";

export class GrokBuildError extends Error {
  readonly kind: GrokBuildKind;
  constructor(kind: GrokBuildKind, message: string) {
    super(message);
    this.name = "GrokBuildError";
    this.kind = kind;
  }
}

export interface GrokBinary {
  found: boolean;
  path: string;
  version: string;
  versionOk: boolean;
  /** GROK_BIN was set, and it was not absolute even after expanding a leading ~. */
  pathRejected?: boolean;
}

export interface GrokBuildOutput {
  text: string;
  stopReason: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface GrokDoctorProbe {
  found: boolean;
  versionOk: boolean;
  version: string;
  path: string;
  auth: "skipped" | "ok" | "unauthenticated" | "failed";
  authDetail: string;
  pathRejected?: boolean;
}

export function grokCandidatePaths(home: string): string[] {
  return [
    path.join(home, ".grok", "bin", "grok"),
    "/opt/homebrew/bin/grok",
    "/usr/local/bin/grok",
    path.join(home, ".local", "bin", "grok"),
  ];
}

/** PATH, HOME, and LANG only. Secrets in the parent environment stay there. */
export function minimalGrokEnv(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {
    LANG: source.LANG?.trim() || "C.UTF-8",
  };
  if (source.PATH) env.PATH = source.PATH;
  if (source.HOME) env.HOME = source.HOME;
  return env;
}

function isExecutable(file: string): boolean {
  try {
    if (path.basename(file) === "auth.json") return false;
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function versionOf(file: string, env: Record<string, string>): string | null {
  const result = spawnSync(file, ["--version"], {
    encoding: "utf8",
    timeout: 8_000,
    shell: false,
    env: env as NodeJS.ProcessEnv,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  const line = `${result.stdout ?? ""}`
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row.length > 0) ?? "";
  return /^grok \d/.test(line) ? line : null;
}

/**
 * Expand a leading ~ or ~/ against the provided home. A relative path, or
 * ~otheruser, is rejected so it cannot be resolved against the current directory.
 */
export function absoluteGrokPath(raw: string, home: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let expanded = trimmed;
  if (expanded === "~" || expanded.startsWith("~/")) {
    if (!path.isAbsolute(home)) return null;
    expanded = expanded === "~" ? home : path.join(home, expanded.slice(2));
  }
  if (!path.isAbsolute(expanded)) return null;
  return expanded;
}

export function resolveGrokBinary(input: {
  home: string;
  configuredPath?: string;
  env?: Record<string, string | undefined>;
}): GrokBinary {
  const env = minimalGrokEnv(input.env);
  const configuredRaw = input.configuredPath?.trim();
  const wellKnown = grokCandidatePaths(input.home).filter((candidate) => path.isAbsolute(candidate));
  let configured: string | null = null;
  if (configuredRaw) {
    configured = absoluteGrokPath(configuredRaw, input.home);
    if (!configured) {
      return { found: false, path: "", version: "", versionOk: false, pathRejected: true };
    }
  }
  const candidates = configured ? [configured, ...wellKnown] : wellKnown;
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    const file = path.resolve(candidate);
    if (seen.has(file)) continue;
    seen.add(file);
    if (!isExecutable(file)) continue;
    const version = versionOf(file, env);
    if (!version) continue;
    return { found: true, path: file, version, versionOk: true };
  }
  return {
    found: false,
    path: configured ?? "",
    version: "",
    versionOk: false,
  };
}

export function buildGrokArgv(input: {
  promptFile: string;
  cwd: string;
  systemPrompt: string;
  model?: string;
}): string[] {
  const argv = [
    "--no-auto-update",
    "--prompt-file",
    input.promptFile,
    "--output-format",
    "json",
    "--tools",
    "",
    "--max-turns",
    "1",
    "--no-subagents",
    "--disable-web-search",
    "--no-plan",
    "--cwd",
    input.cwd,
    // No file flag exists for this override in grok 1.0.77. --rules only appends.
    "--system-prompt-override",
    input.systemPrompt,
    "--verbatim",
  ];
  if (input.systemPrompt.length > SYSTEM_PROMPT_MAX_CHARS) {
    throw new GrokBuildError(
      "protocol",
      "The songwriter instructions are too long to pass to Grok Build.",
    );
  }
  const model = input.model?.trim();
  if (model) argv.push("-m", model);
  const banned = ["--yolo", "--always-approve", "--permission-mode", "bypassPermissions"];
  if (argv.some((arg) => banned.includes(arg))) {
    throw new GrokBuildError("protocol", "Refusing a Grok flag that can approve tools.");
  }
  return argv;
}

function finishedTurn(reason: string): boolean {
  return reason === "end_turn" || reason === "EndTurn";
}

function looksUnauthenticated(text: string): boolean {
  return /not authenticated|you are not signed in|please (?:log|sign) in|run [`']?grok login/i.test(text);
}

/**
 * Last complete top-level `{...}` object. A leading banner is ignored.
 * An incomplete tail does not hide an earlier object. If the last complete
 * object is not JSON, the reply is refused.
 */
export function lastGrokJsonObject(raw: string): unknown {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }
  const last = candidates[candidates.length - 1];
  if (!last) throw new GrokBuildError("protocol", "Grok Build did not return JSON.");
  try {
    const value = JSON.parse(last) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new GrokBuildError("protocol", "Grok Build did not return JSON.");
    }
    return value;
  } catch (err) {
    if (err instanceof GrokBuildError) throw err;
    throw new GrokBuildError("protocol", "Grok Build did not return JSON.");
  }
}

let inFlight = 0;
const waiters: Array<() => void> = [];

function concurrencyLimit(env: Record<string, string | undefined>): number {
  const raw = env.GROK_BUILD_CONCURRENCY?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(2, Math.max(1, parsed));
}

function resolveTimeout(env: Record<string, string | undefined>, override?: number): number {
  if (override != null && Number.isFinite(override) && override > 0) return override;
  const raw = env.GROK_BUILD_TIMEOUT_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return parsed;
}

async function withSlot<T>(limit: number, fn: () => Promise<T>): Promise<T> {
  if (inFlight >= limit) {
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  } else {
    inFlight += 1;
  }
  try {
    return await fn();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else inFlight -= 1;
  }
}

/**
 * Signal the process group and the child Wavesmith spawned.
 * A grandchild that calls setsid leaves this group and cannot be tracked
 * from the child's pid. Tools are off, so a normal grok run should not start
 * one. The follow-up SIGKILL is cancelled when the child exits, so a pid
 * that the OS reuses is not signalled.
 */
const killTimers = new WeakMap<ChildProcess, NodeJS.Timeout>();

function signalChild(child: ChildProcess, sig: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid != null) {
    try {
      process.kill(-pid, sig);
    } catch {
      // The group is already gone.
    }
  }
  try {
    child.kill(sig);
  } catch {
    // The child is already gone.
  }
}

function killGroup(child: ChildProcess): void {
  signalChild(child, "SIGTERM");
  if (killTimers.has(child)) return;
  const timer = setTimeout(() => signalChild(child, "SIGKILL"), 400);
  timer.unref();
  killTimers.set(child, timer);
}

function disarmKill(child: ChildProcess): void {
  const timer = killTimers.get(child);
  if (!timer) return;
  clearTimeout(timer);
  killTimers.delete(child);
}

export interface GrokRunHooks {
  /** Called after the process exits and before the temp directory is removed. */
  afterRun?: (dir: string) => void;
}

export async function runGrokBuild(input: {
  prompt: string;
  systemPrompt: string;
  model?: string;
  home: string;
  configuredPath?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  hooks?: GrokRunHooks;
}): Promise<GrokBuildOutput> {
  const sourceEnv = input.env ?? process.env;
  return withSlot(concurrencyLimit(sourceEnv), () => executeGrok(input, sourceEnv));
}

async function executeGrok(
  input: {
    prompt: string;
    systemPrompt: string;
    model?: string;
    home: string;
    configuredPath?: string;
    timeoutMs?: number;
    hooks?: GrokRunHooks;
  },
  sourceEnv: Record<string, string | undefined>,
): Promise<GrokBuildOutput> {
  const binary = resolveGrokBinary({
    home: input.home,
    configuredPath: input.configuredPath ?? sourceEnv.GROK_BIN,
    env: sourceEnv,
  });
  if (binary.pathRejected) {
    throw new GrokBuildError(
      "missing",
      "GROK_BIN must be an absolute path, or start with ~/. A relative path is not used.",
    );
  }
  if (!binary.found) {
    throw new GrokBuildError(
      "missing",
      "Grok Build CLI was not found. Install it, then open Terminal and run `grok login`.",
    );
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-grok-"));
  fs.chmodSync(dir, 0o700);
  const promptFile = path.join(dir, "prompt.txt");
  let child: ChildProcess | null = null;
  let timedOut = false;
  let tooBig = false;
  try {
    fs.writeFileSync(promptFile, input.prompt, { mode: 0o600 });
    const argv = buildGrokArgv({
      promptFile,
      cwd: dir,
      systemPrompt: input.systemPrompt,
      model: input.model,
    });
    const childEnv = minimalGrokEnv(sourceEnv);
    childEnv.HOME = input.home;
    const proc = spawn(binary.path, argv, {
      cwd: dir,
      env: childEnv as NodeJS.ProcessEnv,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child = proc;

    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    const stderrHeadMax = 8 * 1024;
    const stderrTailMax = 56 * 1024;
    let stderrHead = Buffer.alloc(0);
    let stderrTail = Buffer.alloc(0);
    let stderrTrimmed = false;
    let sawAuth = false;
    let authOverlap = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > STDOUT_CAP_BYTES) {
        tooBig = true;
        killGroup(proc);
        return;
      }
      stdout.push(chunk);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (looksUnauthenticated(authOverlap + text)) sawAuth = true;
      authOverlap = (authOverlap + text).slice(-80);
      if (stderrHead.length < stderrHeadMax) {
        const need = stderrHeadMax - stderrHead.length;
        stderrHead = Buffer.concat([stderrHead, chunk.subarray(0, need)]);
      }
      stderrTail = Buffer.concat([stderrTail, chunk]);
      if (stderrTail.length > stderrTailMax) {
        stderrTrimmed = true;
        stderrTail = stderrTail.subarray(stderrTail.length - stderrTailMax);
      }
    });

    const killer = setTimeout(() => {
      timedOut = true;
      if (child) killGroup(child);
    }, resolveTimeout(sourceEnv, input.timeoutMs));
    killer.unref();

    const code = await new Promise<number | null>((resolve) => {
      proc.on("error", () => {
        disarmKill(proc);
        resolve(null);
      });
      proc.on("close", (status) => {
        disarmKill(proc);
        resolve(status);
      });
    });
    clearTimeout(killer);
    disarmKill(proc);

    const errText = stderrTrimmed
      ? `${stderrHead.toString("utf8")}\n…\n${stderrTail.toString("utf8")}`
      : stderrTail.toString("utf8");
    if (tooBig) {
      throw new GrokBuildError("output", "Grok Build returned more output than Wavesmith will read.");
    }
    if (timedOut) {
      throw new GrokBuildError("timeout", "Grok Build took too long and was stopped.");
    }
    if (code !== 0 && (sawAuth || looksUnauthenticated(errText))) {
      throw new GrokBuildError(
        "unauthenticated",
        "Grok Build is not signed in. Open Terminal and run `grok login`.",
      );
    }
    if (code !== 0) {
      const detail = errText.trim().slice(0, 300);
      throw new GrokBuildError(
        "exit",
        detail
          ? `Grok Build exited ${code ?? "without a status"}: ${detail}`
          : `Grok Build exited ${code ?? "without a status"}.`,
      );
    }

    const parsed = lastGrokJsonObject(Buffer.concat(stdout).toString("utf8"));
    const result = ResultSchema.safeParse(parsed);
    if (!result.success) {
      throw new GrokBuildError("protocol", "Grok Build returned JSON without text and stopReason.");
    }
    if (!finishedTurn(result.data.stopReason)) {
      throw new GrokBuildError(
        "protocol",
        `Grok Build stopped with ${result.data.stopReason} instead of end_turn.`,
      );
    }
    const text = result.data.text.trim();
    if (!text) throw new GrokBuildError("protocol", "Grok Build returned an empty reply.");
    const usage = result.data.usage;
    const fromUsage = Object.keys(result.data.modelUsage ?? {})[0];
    const model = fromUsage ?? (input.model?.trim() || "grok");
    return {
      text,
      stopReason: result.data.stopReason,
      model,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      reasoningTokens: usage?.reasoning_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      costUsd: result.data.total_cost_usd ?? 0,
    };
  } finally {
    try {
      input.hooks?.afterRun?.(dir);
    } catch {
      // Cleanup still runs when the hook fails.
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function inspectGrokBuild(input: {
  deep: boolean;
  home: string;
  env?: Record<string, string | undefined>;
  configuredPath?: string;
  /** When set, a successful --deep probe is added to the Settings usage file. */
  dataDir?: string;
}): Promise<GrokDoctorProbe> {
  const env = input.env ?? process.env;
  const binary = resolveGrokBinary({
    home: input.home,
    configuredPath: input.configuredPath ?? env.GROK_BIN,
    env,
  });
  if (binary.pathRejected) {
    return {
      found: false,
      versionOk: false,
      version: "",
      path: "",
      auth: "skipped",
      authDetail: "GROK_BIN must be an absolute path, or start with ~/.",
      pathRejected: true,
    };
  }
  if (!binary.found) {
    return { found: false, versionOk: false, version: "", path: "", auth: "skipped", authDetail: "" };
  }
  if (!input.deep) {
    return {
      found: true,
      versionOk: true,
      version: binary.version,
      path: binary.path,
      auth: "skipped",
      authDetail: "",
    };
  }
  try {
    const output = await runGrokBuild({
      prompt: "Reply with the single word ok.",
      systemPrompt: "Reply with the single word ok.",
      home: input.home,
      configuredPath: binary.path,
      env,
      timeoutMs: 30_000,
    });
    if (input.dataDir) {
      try {
        recordGrokUsageFile(input.dataDir, {
          model: output.model,
          inputTokens: output.inputTokens,
          outputTokens: output.outputTokens,
          reasoningTokens: output.reasoningTokens,
          totalTokens: output.totalTokens,
          costUsd: output.costUsd,
        });
      } catch {
        // The probe already succeeded. A full disk can miss this one row.
      }
    }
    return {
      found: true,
      versionOk: true,
      version: binary.version,
      path: binary.path,
      auth: "ok",
      authDetail: "Signed in.",
    };
  } catch (err) {
    if (err instanceof GrokBuildError && err.kind === "unauthenticated") {
      return {
        found: true,
        versionOk: true,
        version: binary.version,
        path: binary.path,
        auth: "unauthenticated",
        authDetail: err.message,
      };
    }
    const message = err instanceof Error ? err.message : "The sign-in probe failed.";
    return {
      found: true,
      versionOk: true,
      version: binary.version,
      path: binary.path,
      auth: "failed",
      authDetail: message,
    };
  }
}
