/**
 * cli/io.ts — what the command runner asks the machine to do.
 * Tests pass a fake. The real command line uses cli/real-io.ts.
 */

import type { Flags } from "./args.ts";
import type { ProcessIdentity } from "./identity.ts";

export interface CommandProbe {
  ok: boolean;
  version: string;
}

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
  platform: string;
  home: string;
  root: string;
  stateDir: string;
  uid: number;
  readText(path: string): string | null;
  writeText(path: string, data: string): void;
  remove(path: string): void;
  exists(path: string): boolean;
  pidAlive(pid: number): boolean;
  /** Command line and start time, or null when the pid is gone. Not a kill -0 check. */
  processIdentity(pid: number): ProcessIdentity | null;
  /** Exclusive start lock. False means another start holds it. */
  acquireStartLock(): boolean;
  releaseStartLock(): void;
  waitUntilListening(port: number, budgetMs: number): Promise<boolean>;
  listenAddresses(port: number): string[];
  diskFreeBytes(): number;
  command(name: string): CommandProbe;
  engineHealthy(): Promise<boolean>;
  weightsPresent(): boolean;
  buildPresent(): boolean;
  exec(command: string, args: string[]): { code: number };
  spawnSupervisor(extra: Record<string, string>): number | null;
  supervise(flags: Pick<Flags, "noOpen">): Promise<number>;
  signal(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
  openUrl(url: string): void;
  isTty(): boolean;
  prompt(question: string): string;
  sleep(ms: number): void;
  logText(): string | null;
  followLogs(): void;
}
