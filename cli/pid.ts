/**
 * cli/pid.ts — one Wavesmith at a time.
 * The supervisor pid is the lock. A dead pid file is stale and may be replaced.
 */

import { assessPort } from "./ports.ts";

export interface PidRecord {
  supervisorPid: number;
  enginePid: number | null;
  appPid: number | null;
  port: number;
  startedAt: string;
}

export function serializePid(record: PidRecord): string {
  return `${JSON.stringify(record)}\n`;
}

export function parsePid(raw: string | null): PidRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PidRecord>;
    if (typeof value.supervisorPid !== "number" || !Number.isInteger(value.supervisorPid)) return null;
    if (typeof value.port !== "number" || !Number.isInteger(value.port)) return null;
    return {
      supervisorPid: value.supervisorPid,
      enginePid: typeof value.enginePid === "number" ? value.enginePid : null,
      appPid: typeof value.appPid === "number" ? value.appPid : null,
      port: value.port,
      startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
    };
  } catch {
    return null;
  }
}

export type StartDecision =
  | { action: "already"; port: number }
  | { action: "start" }
  | { action: "refuse"; message: string; fix: string };

export function decideStart(input: {
  record: PidRecord | null;
  supervisorAlive: boolean;
  listeners: readonly string[];
  port: number;
}): StartDecision {
  if (input.record && input.supervisorAlive) {
    return { action: "already", port: input.record.port };
  }
  const assessment = assessPort(input.port, input.listeners);
  if (!assessment.ok) {
    return {
      action: "refuse",
      message: assessment.detail,
      fix: assessment.fix ?? `Free port ${input.port}, then run: wavesmith start`,
    };
  }
  if (input.listeners.length > 0) {
    return {
      action: "refuse",
      message: `Port ${input.port} is already in use on ${input.listeners.join(", ")}.`,
      fix: "Stop the other copy with: wavesmith stop",
    };
  }
  return { action: "start" };
}

export function portFrom(env: Record<string, string | undefined>): number {
  const port = Number.parseInt(env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 3000;
  return port;
}
