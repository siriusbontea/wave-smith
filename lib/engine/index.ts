/**
 * lib/engine/index.ts — EngineClient factory: real vs mock by MOCK_ENGINE.
 *
 * The instance is cached on globalThis (same HMR-safety trick as lib/db) so the
 * mock's in-memory task state survives dev-mode module reloads — without this,
 * a mock generation could lose its task between two polls.
 */
import { env } from "@/lib/env";
import { AceStepClient } from "./acestep";
import { MockEngineClient } from "./mock";
import type { EngineClient } from "./types";

const globalForEngine = globalThis as unknown as {
  __wavesmithEngine?: EngineClient;
};

export function getEngineClient(): EngineClient {
  if (!globalForEngine.__wavesmithEngine) {
    globalForEngine.__wavesmithEngine = env.MOCK_ENGINE
      ? new MockEngineClient()
      : new AceStepClient();
  }
  return globalForEngine.__wavesmithEngine;
}

export * from "./types";
