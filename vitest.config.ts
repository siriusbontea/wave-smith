/**
 * vitest.config.ts — server-side unit tests (node environment).
 *
 * pool/isolate are PINNED, not defaults-by-luck: lib/env captures process.env
 * at import time and lib/db, lib/queue, lib/engine, lib/lyrics all cache
 * singletons on globalThis — correctness requires each test file to run in its
 * own forked process with its own temp DATA_DIR (tests/setup.ts).
 */
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    isolate: true,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
