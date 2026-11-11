/**
 * A failed or stopped setup stays on screen with a next step.
 * The studio, and its engine-offline banner, stay hidden until that file is cleared.
 */
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

function progressFile(): string {
  const dataDir = fs.readFileSync(path.join(os.tmpdir(), "wavesmith-e2e-datadir"), "utf8").trim();
  return path.join(dataDir, "setup-progress.json");
}

test("failed and stopped setup explain the next step", async ({ page }) => {
  const file = progressFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const loopback = await page.request.get("/api/setup");
    expect(loopback.status()).toBe(200);
    const idle = (await loopback.json()) as Record<string, unknown>;
    expect(Object.keys(idle).sort()).toEqual(["etaSeconds", "message", "percent", "phase", "running"]);

    const rejected = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: 3100,
          path: "/api/setup",
          headers: { Host: "10.1.2.3:3100" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(rejected).toBe(403);

    fs.writeFileSync(
      file,
      JSON.stringify({
        running: false,
        phase: "failed",
        percent: null,
        etaSeconds: null,
        message: "Setup stopped before it finished.",
        token: "secret",
        path: "/tmp/should-not-leak",
      }),
    );
    const body = (await (await page.request.get("/api/setup")).json()) as Record<string, unknown>;
    expect(body.phase).toBe("failed");
    expect(body.running).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/secret|should-not-leak/);
    expect(Object.keys(body).sort()).toEqual(["etaSeconds", "message", "percent", "phase", "running"]);

    await page.goto("/");
    await expect(page.getByTestId("setup-screen")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Setup did not finish" })).toBeVisible();
    await expect(page.getByTestId("setup-next")).toContainText("run the installer again");
    await expect(page.getByTestId("setup-next")).toContainText("songs stay");
    await expect(page.getByTestId("prompt-input")).toHaveCount(0);
    const cloudArtifacts = "/opt/cursor/artifacts";
    const shotDir = fs.existsSync(cloudArtifacts) ? cloudArtifacts : path.join(process.cwd(), "test-results");
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, "setup-failed.png"), fullPage: true });

    fs.writeFileSync(
      file,
      JSON.stringify({
        running: false,
        phase: "stopped",
        message: "Setup stopped before it finished.",
      }),
    );
    await page.reload();
    await expect(page.getByTestId("setup-next")).toBeVisible();
    await expect(page.getByTestId("prompt-input")).toHaveCount(0);

    fs.rmSync(file, { force: true });
    await page.reload();
    await expect(page.getByTestId("setup-screen")).toHaveCount(0);
    await expect(page.getByTestId("prompt-input")).toBeVisible();
  } finally {
    fs.rmSync(file, { force: true });
  }
});
