/**
 * tests/setup.ts — runs before each test file's imports (vitest setupFiles).
 * Gives the file an isolated temp DATA_DIR (own SQLite db + audio dir) and
 * forces mock mode: the suite must pass with NO engine and NO GPU (spec §6.1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Sentinel: if two test files ever share a process (isolation flags flipped),
// fail loudly instead of silently sharing one db/env.
const sentinel = globalThis as { __wavesmithTestSetupRan?: boolean };
if (sentinel.__wavesmithTestSetupRan) {
  throw new Error(
    "Test isolation broken: two test files share one process. " +
      "lib/env + the globalThis singletons require pool:'forks' + isolate:true.",
  );
}
sentinel.__wavesmithTestSetupRan = true;

process.env.MOCK_ENGINE = "1";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-test-"));
process.env.DATA_DIR = dataDir;

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
