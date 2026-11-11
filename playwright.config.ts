/**
 * playwright.config.ts — smoke tests only (spec §3.1), always in mock mode:
 * no engine, no GPU, deterministic. `pnpm test:e2e` builds first (the script
 * is `pnpm build && playwright test`), so the webServer never runs stale code.
 */
import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolated runtime data per run: the smoke suite must not touch real
// libraries. Guarded so worker processes (which also evaluate this config)
// don't each leak an orphan temp dir.
const dataPointer = path.join(os.tmpdir(), "wavesmith-e2e-datadir");
const dataDir =
  process.env.TEST_WORKER_INDEX === undefined
    ? fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-e2e-"))
    : fs.readFileSync(dataPointer, "utf8").trim();
if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.writeFileSync(dataPointer, dataDir);
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  // One server and one library. Parallel workers would see each other's jobs.
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      MOCK_ENGINE: "1",
      DATA_DIR: dataDir,
    },
  },
});
