/**
 * cli/real-io.ts — the machine behind `wavesmith`.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CliIo } from "./io.ts";
import { addressesOnPort, parseLsof, parseProcNet } from "./ports.ts";
import { homeDir, repoRoot, stateDirectory } from "./paths.ts";
import { supervise } from "./supervise.ts";
import { WEIGHT_FILES } from "./weights.ts";

export function realIo(): CliIo {
  const root = repoRoot(import.meta.url, process.env);
  const home = homeDir();
  const stateDir = stateDirectory({ env: process.env, home, platform: process.platform });
  fs.mkdirSync(stateDir, { recursive: true });
  const logPath = path.join(stateDir, "wavesmith.log");
  const mainPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "main.ts");

  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    platform: process.platform,
    home,
    root,
    stateDir,
    uid: typeof process.getuid === "function" ? process.getuid() : 0,
    readText(file) {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
    writeText(file, data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
    },
    remove(file) {
      fs.rmSync(file, { recursive: true, force: true });
    },
    exists(file) {
      return fs.existsSync(file);
    },
    pidAlive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    listenAddresses(port) {
      return listenAddresses(port);
    },
    diskFreeBytes() {
      try {
        const stats = fs.statfsSync(root);
        return Number(stats.bavail) * Number(stats.bsize);
      } catch {
        return 0;
      }
    },
    command(name) {
      const result = spawnSync(name, ["--version"], { encoding: "utf8" });
      if (result.error || result.status !== 0) return { ok: false, version: "" };
      const version = `${result.stdout || result.stderr || ""}`.trim().split("\n")[0] ?? "";
      return { ok: true, version };
    },
    async engineHealthy() {
      try {
        const response = await fetch("http://127.0.0.1:8001/health", { signal: AbortSignal.timeout(2000) });
        return response.ok;
      } catch {
        return false;
      }
    },
    weightsPresent() {
      const engineDir = path.resolve(root, process.env.ENGINE_DIR || "engine/ACE-Step-1.5");
      return WEIGHT_FILES.every((file) => fs.existsSync(path.join(engineDir, "checkpoints", file)));
    },
    buildPresent() {
      return fs.existsSync(path.join(root, ".next", "BUILD_ID"));
    },
    exec(command, args) {
      const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
      return { code: result.status ?? 1 };
    },
    spawnSupervisor(extra) {
      const logFd = fs.openSync(logPath, "a");
      const child = spawn(process.execPath, ["--experimental-strip-types", mainPath, "__supervise"], {
        cwd: root,
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: { ...process.env, ...extra },
      });
      child.unref();
      fs.closeSync(logFd);
      return child.pid ?? null;
    },
    supervise(flags) {
      return supervise(flags);
    },
    signal(pid, signal) {
      try {
        process.kill(-pid, signal);
      } catch {
        // Not a process group.
      }
      try {
        process.kill(pid, signal);
      } catch {
        // Already gone.
      }
    },
    openUrl(url) {
      const command = process.platform === "darwin" ? "open" : "xdg-open";
      const child = spawn(command, [url], { detached: true, stdio: "ignore" });
      child.unref();
    },
    isTty() {
      return process.stdin.isTTY === true;
    },
    prompt(question) {
      process.stdout.write(question);
      const buffer = Buffer.alloc(512);
      try {
        const count = fs.readSync(0, buffer, 0, buffer.length, null);
        return buffer.toString("utf8", 0, count);
      } catch {
        return "";
      }
    },
    sleep(ms) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    },
    logText() {
      try {
        return fs.readFileSync(logPath, "utf8");
      } catch {
        return null;
      }
    },
    followLogs() {
      if (!fs.existsSync(logPath)) {
        process.stdout.write("No log yet. Start Wavesmith, then run: wavesmith logs -f\n");
        return;
      }
      spawnSync("tail", ["-n", "200", "-f", logPath], { stdio: "inherit" });
    },
  };
}

export function listenAddresses(port: number): string[] {
  if (fs.existsSync("/proc/net/tcp")) {
    const v4 = parseProcNet(fs.readFileSync("/proc/net/tcp", "utf8"), "v4");
    const v6 = fs.existsSync("/proc/net/tcp6") ? parseProcNet(fs.readFileSync("/proc/net/tcp6", "utf8"), "v6") : [];
    return [...new Set(addressesOnPort([...v4, ...v6], port))];
  }
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  return [...new Set(addressesOnPort(parseLsof(result.stdout || ""), port))];
}
