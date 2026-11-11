/**
 * Setup progress: a running download becomes the screen, and a bad file does not.
 */
import { describe, expect, it } from "vitest";
import { formatEta, interpretSetup } from "@/lib/setup/progress";
import { readSetupStatus } from "@/lib/setup/status";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("setup progress", () => {
  it("reads a running download and an estimate", () => {
    const view = interpretSetup(
      JSON.stringify({
        running: true,
        phase: "weights",
        percent: 42,
        etaSeconds: 600,
        message: "Downloading the music models",
      }),
    );
    expect(view.running).toBe(true);
    expect(view.percent).toBe(42);
    expect(formatEta(view.etaSeconds)).toBe("About 10 minutes left");
    expect(formatEta(20)).toBe("Less than a minute left");
    expect(formatEta(null)).toBeNull();
  });

  it("ignores a missing or broken file", () => {
    expect(interpretSetup(null).running).toBe(false);
    expect(interpretSetup("{").running).toBe(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-setup-"));
    expect(readSetupStatus(dir).running).toBe(false);
    fs.writeFileSync(
      path.join(dir, "setup-progress.json"),
      JSON.stringify({ running: true, phase: "weights", percent: 10, etaSeconds: 90, message: "Downloading" }),
    );
    expect(readSetupStatus(dir).percent).toBe(10);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
