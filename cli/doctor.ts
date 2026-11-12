/**
 * cli/doctor.ts — plain checks and a plain fix for each failure.
 * Probes are injected so tests do not need Homebrew, a GPU, or a live port.
 */

import type { GrokDoctorProbe } from "./grok-build.ts";
import { assessPort } from "./ports.ts";

export interface CommandProbe {
  ok: boolean;
  version: string;
}

export interface DoctorInput {
  commands: {
    brew: CommandProbe;
    node: CommandProbe;
    pnpm: CommandProbe;
    uv: CommandProbe;
    ffmpeg: CommandProbe;
    python312: CommandProbe;
    git: CommandProbe;
  };
  diskFreeBytes: number;
  weightsPresent: boolean;
  port3000: readonly string[];
  port8001: readonly string[];
  /** Meaningful when something is already listening on 8001. */
  engineHealthy: boolean;
  /** Omitted in older callers. A missing CLI is optional and does not fail doctor. */
  grok?: GrokDoctorProbe;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

const GB = 1024 * 1024 * 1024;

export function nodeMajor(version: string): number | null {
  const match = /v?(\d+)/.exec(version);
  const major = match?.[1];
  if (!major) return null;
  const value = Number.parseInt(major, 10);
  return Number.isFinite(value) ? value : null;
}

export function doctorChecks(input: DoctorInput): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    tool("Homebrew", input.commands.brew, "Install Homebrew from https://brew.sh, then run the Wavesmith installer again."),
    nodeCheck(input.commands.node),
    tool("pnpm", input.commands.pnpm, "brew install pnpm"),
    tool("uv", input.commands.uv, "brew install uv"),
    tool("ffmpeg", input.commands.ffmpeg, "brew install ffmpeg"),
    tool("Python 3.12", input.commands.python312, "brew install python@3.12"),
    tool("git", input.commands.git, "brew install git"),
    diskCheck(input.diskFreeBytes, input.weightsPresent),
    weightsCheck(input.weightsPresent),
    portCheck("App port 3000", 3000, input.port3000),
    portCheck("Engine port 8001", 8001, input.port8001),
    engineCheck(input),
    grokCheck(input.grok),
  ];
  return checks;
}

export function doctorFailed(checks: readonly DoctorCheck[]): boolean {
  return checks.some((check) => !check.ok);
}

export function formatDoctor(checks: readonly DoctorCheck[]): string {
  const lines: string[] = [];
  for (const check of checks) {
    lines.push(`${check.ok ? "OK  " : "FAIL"}  ${check.name}`);
    lines.push(`      ${check.detail}`);
    if (!check.ok && check.fix) lines.push(`      Fix: ${check.fix}`);
  }
  return `${lines.join("\n")}\n`;
}

function tool(name: string, probe: CommandProbe, fix: string): DoctorCheck {
  if (!probe.ok) return { name, ok: false, detail: `${name} is not installed.`, fix };
  return { name, ok: true, detail: probe.version || `${name} is installed.` };
}

function nodeCheck(node: CommandProbe): DoctorCheck {
  if (!node.ok) {
    return { name: "Node.js", ok: false, detail: "Node.js is not installed.", fix: "brew install node@22" };
  }
  const major = nodeMajor(node.version);
  if (major == null || major < 22) {
    return {
      name: "Node.js",
      ok: false,
      detail: `Node.js ${node.version || "is installed"}, and Wavesmith needs Node 22 or newer.`,
      fix: "brew install node@22",
    };
  }
  return { name: "Node.js", ok: true, detail: `Node.js ${node.version}` };
}

function diskCheck(free: number, weightsPresent: boolean): DoctorCheck {
  const need = weightsPresent ? 5 * GB : 25 * GB;
  const needLabel = weightsPresent ? "5" : "25";
  const freeLabel = (free / GB).toFixed(1);
  if (free >= need) {
    return {
      name: "Disk space",
      ok: true,
      detail: `${freeLabel} GB free. About ${needLabel} GB should stay free.`,
    };
  }
  return {
    name: "Disk space",
    ok: false,
    detail: `${freeLabel} GB free. About ${needLabel} GB should stay free.`,
    fix: `Free about ${needLabel} GB, then run the installer again.`,
  };
}

function weightsCheck(present: boolean): DoctorCheck {
  if (present) return { name: "Model weights", ok: true, detail: "The music models are on disk." };
  return {
    name: "Model weights",
    ok: false,
    detail: "The music models are not downloaded yet.",
    fix: "Run the installer again. From a checkout you already have: scripts/setup.sh",
  };
}

function portCheck(name: string, port: number, addresses: readonly string[]): DoctorCheck {
  const assessment = assessPort(port, addresses);
  return {
    name,
    ok: assessment.ok,
    detail: assessment.detail,
    ...(assessment.fix ? { fix: assessment.fix } : {}),
  };
}

function grokCheck(probe: GrokDoctorProbe | undefined): DoctorCheck {
  if (!probe) {
    return { name: "Grok Build", ok: true, detail: "Grok Build was not checked." };
  }
  if (probe.pathRejected) {
    return {
      name: "Grok Build",
      ok: false,
      detail: "GROK_BIN must be an absolute path, or start with ~/.",
      fix: "Set GROK_BIN to the grok binary, for example ~/.grok/bin/grok.",
    };
  }
  if (!probe.found) {
    return {
      name: "Grok Build",
      ok: true,
      detail: "Grok Build CLI is not installed. Subscription lyrics stay off until it is.",
    };
  }
  if (!probe.versionOk) {
    return {
      name: "Grok Build",
      ok: false,
      detail: probe.path
        ? `Found ${probe.path}, but it did not report a Grok version.`
        : "Grok Build did not report a version.",
      fix: "Reinstall the Grok Build CLI from https://x.ai/cli",
    };
  }
  if (probe.auth === "unauthenticated") {
    return {
      name: "Grok Build",
      ok: false,
      detail: `${probe.version} is not signed in.`,
      fix: "Open Terminal and run `grok login`.",
    };
  }
  if (probe.auth === "failed") {
    return {
      name: "Grok Build",
      ok: false,
      detail: probe.authDetail || "The sign-in probe failed.",
      fix: "Open Terminal and run `grok login`, then run wavesmith doctor --deep again.",
    };
  }
  if (probe.auth === "ok") {
    return { name: "Grok Build", ok: true, detail: `${probe.version} is signed in.` };
  }
  return {
    name: "Grok Build",
    ok: true,
    detail: `${probe.version}. Sign-in was not checked. Run wavesmith doctor --deep to check it.`,
  };
}

function engineCheck(input: DoctorInput): DoctorCheck {
  if (input.port8001.length === 0) {
    return {
      name: "Engine health",
      ok: true,
      detail: "The engine is not running. That is normal until you start Wavesmith.",
    };
  }
  if (input.engineHealthy) {
    return { name: "Engine health", ok: true, detail: "The engine answered on 127.0.0.1:8001." };
  }
  return {
    name: "Engine health",
    ok: false,
    detail: "Something is on port 8001, and it did not answer a health check.",
    fix: "Run: wavesmith stop && wavesmith start",
  };
}
