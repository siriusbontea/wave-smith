/**
 * Setup progress: a running download becomes the screen, and a bad file does not.
 */
import { describe, expect, it } from "vitest";
import { formatEta, interpretSetup, setupBlocksStudio, setupNextStep } from "@/lib/setup/progress";
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

  it("keeps a failed or stopped setup on screen, with a next step, and strips extra fields", () => {
    const failed = interpretSetup(
      JSON.stringify({
        running: false,
        phase: "failed",
        message: "Setup stopped before it finished.",
        token: "secret",
        path: "/tmp/x",
      }),
    );
    expect(setupBlocksStudio(failed)).toBe(true);
    expect(setupNextStep(failed)).toMatch(/run the installer again/);
    expect(setupNextStep(failed)).toMatch(/songs stay/);
    expect(JSON.stringify(failed)).not.toMatch(/secret/);
    const stopped = interpretSetup(
      JSON.stringify({ running: false, phase: "stopped", message: "Setup stopped before it finished." }),
    );
    expect(setupBlocksStudio(stopped)).toBe(true);
    expect(setupNextStep(stopped)).toMatch(/installer/);
    const done = interpretSetup(JSON.stringify({ running: false, phase: "done", percent: 100, message: "Setup finished" }));
    expect(setupBlocksStudio(done)).toBe(false);
    expect(setupNextStep(done)).toBeNull();
    expect(setupBlocksStudio(interpretSetup(JSON.stringify({ running: true, phase: "weights", message: "Downloading" })))).toBe(
      true,
    );
  });
});
