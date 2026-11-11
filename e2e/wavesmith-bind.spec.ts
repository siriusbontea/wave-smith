/**
 * wavesmith start on a production build serves 127.0.0.1 and not every interface.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { addressesOnPort, parseProcNet } from "../cli/ports.ts";

const root = path.resolve(__dirname, "..");

function listeners(port: number): string[] {
  const v4 = parseProcNet(fs.readFileSync("/proc/net/tcp", "utf8"), "v4");
  const v6 = fs.existsSync("/proc/net/tcp6") ? parseProcNet(fs.readFileSync("/proc/net/tcp6", "utf8"), "v6") : [];
  return addressesOnPort([...v4, ...v6], port);
}

test("wavesmith start binds 127.0.0.1:3000 only", async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-state-"));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-data-"));
  const env = {
    ...process.env,
    MOCK_ENGINE: "1",
    DATA_DIR: data,
    WAVESMITH_STATE_DIR: state,
    WAVESMITH_ROOT: root,
    PORT: "3000",
    HOSTNAME: "127.0.0.1",
    WAVESMITH_NO_OPEN: "1",
  };
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "cli/main.ts", "start", "--foreground", "--no-open"],
    { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  try {
    const deadline = Date.now() + 45_000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch("http://127.0.0.1:3000/api/health");
        if (response.ok) {
          up = true;
          break;
        }
      } catch {
        // Still booting.
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(up, log).toBe(true);
    const bound = listeners(3000);
    expect(bound).toContain("127.0.0.1");
    expect(bound).not.toContain("0.0.0.0");
    expect(bound).not.toContain("*");
    expect(bound).not.toContain("::");
    const page = await fetch("http://127.0.0.1:3000/");
    expect(page.ok).toBe(true);
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address;
    if (lan) {
      await expect(fetch(`http://${lan}:3000/api/health`, { signal: AbortSignal.timeout(1500) })).rejects.toThrow();
    }
  } finally {
    spawnSync(process.execPath, ["--experimental-strip-types", "cli/main.ts", "stop"], {
      cwd: root,
      env,
    });
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        try {
          process.kill(child.pid, "SIGTERM");
        } catch {
          // Already stopped.
        }
      }
    }
    fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});
