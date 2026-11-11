/**
 * cli/lock.ts — one start at a time.
 * mkdir is atomic. A second start sees the directory and does not spawn.
 * A lock whose owner is gone or is not this command can be taken.
 */

import fs from "node:fs";
import path from "node:path";
import { SUPERVISOR_MARKER, isOurProcess, type ProcessIdentity } from "./identity.ts";

export function lockDir(stateDir: string): string {
  return path.join(stateDir, "start.lock");
}

export function tryAcquireLock(dir: string): boolean {
  try {
    fs.mkdirSync(dir);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export function releaseLock(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

interface LockOwner {
  pid: number;
  startedAt: string;
}

function readLockOwner(dir: string): LockOwner | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(dir, "owner"), "utf8")) as {
      pid?: unknown;
      startedAt?: unknown;
    };
    if (typeof value.pid !== "number" || !Number.isInteger(value.pid)) return null;
    if (typeof value.startedAt !== "string" || value.startedAt.length === 0) return null;
    return { pid: value.pid, startedAt: value.startedAt };
  } catch {
    return null;
  }
}

function writeOwner(dir: string, pid: number, startedAt: string): void {
  fs.writeFileSync(path.join(dir, "owner"), JSON.stringify({ pid, startedAt }));
}

function lockIsStale(dir: string, identity: (pid: number) => ProcessIdentity | null): boolean {
  const owner = readLockOwner(dir);
  if (!owner) {
    try {
      return Date.now() - fs.statSync(dir).mtimeMs > 30_000;
    } catch {
      return true;
    }
  }
  return !isOurProcess({
    expectedStartedAt: owner.startedAt,
    marker: SUPERVISOR_MARKER,
    actual: identity(owner.pid),
  });
}

export function takeStartLock(input: {
  dir: string;
  ownerPid: number;
  ownerStartedAt: string;
  identity: (pid: number) => ProcessIdentity | null;
}): boolean {
  if (!input.ownerStartedAt) return false;
  if (tryAcquireLock(input.dir)) {
    writeOwner(input.dir, input.ownerPid, input.ownerStartedAt);
    return true;
  }
  if (!lockIsStale(input.dir, input.identity)) return false;
  const stale = `${input.dir}.stale.${input.ownerPid}`;
  try {
    fs.renameSync(input.dir, stale);
  } catch {
    return false;
  }
  fs.rmSync(stale, { recursive: true, force: true });
  if (!tryAcquireLock(input.dir)) return false;
  writeOwner(input.dir, input.ownerPid, input.ownerStartedAt);
  return true;
}
