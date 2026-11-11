/**
 * wavesmith's command decisions: arguments, the pid lock, ports, and doctor.
 * The machine is a fake. Nothing here binds a port or shells out.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "../cli/args.ts";
import { doctorChecks, doctorFailed, nodeMajor } from "../cli/doctor.ts";
import { childEnv, loadEnvFile } from "../cli/envfile.ts";
import { parseBtime, parseKernProcStart, parseProcStatStart, readProcessIdentity, isOurProcess, SUPERVISOR_MARKER } from "../cli/identity.ts";
import { classifyDelete, hasWavesmithMarker, isDeniedSystemPath, SYSTEM_DIR_NAMES, type DeleteIO } from "../cli/uninstall-guard.ts";
import type { CliIo } from "../cli/io.ts";
import { renderLaunchAgent } from "../cli/launchd.ts";
import { releaseLock, takeStartLock, tryAcquireLock } from "../cli/lock.ts";
import { decideStart, parsePid, portFrom, serializePid } from "../cli/pid.ts";
import { lastLines, planUninstall, resolveConfiguredDir, stripWavesmithPath, updateCommands } from "../cli/plans.ts";
import { addressesOnPort, assessPort, parseLsof, parseProcNet, parseSs } from "../cli/ports.ts";
import { realIo } from "../cli/real-io.ts";
import { run } from "../cli/run.ts";

function installerProgress(): string {
  return JSON.stringify({
    running: false,
    phase: "done",
    percent: 100,
    etaSeconds: null,
    message: "Setup finished",
    updatedAt: "2026-11-11T00:00:00.000Z",
  });
}

const commands = ["start", "stop", "status", "open", "update", "doctor", "logs", "uninstall", "login"] as const;

function fakeIo(overrides: Partial<CliIo> = {}): CliIo & {
  out: string;
  err: string;
  removed: string[];
  written: Record<string, string>;
  spawned: number;
  supervised: number;
  execs: string[][];
} {
  const files: Record<string, string> = {};
  const alive = new Set<number>();
  const io = {
    out: "",
    err: "",
    removed: [] as string[],
    written: files,
    spawned: 0,
    supervised: 0,
    execs: [] as string[][],
    stdout(text: string) {
      io.out += text;
    },
    stderr(text: string) {
      io.err += text;
    },
    env: { PORT: "3000" } as Record<string, string | undefined>,
    platform: "darwin",
    home: "/Users/ada",
    root: "/Users/ada/Wavesmith",
    stateDir: "/Users/ada/Library/Application Support/Wavesmith",
    uid: 501,
    readText(file: string) {
      return files[file] ?? null;
    },
    writeText(file: string, data: string) {
      files[file] = data;
    },
    remove(file: string) {
      io.removed.push(file);
      delete files[file];
    },
    exists(file: string) {
      return file in files || file.endsWith("/.venv") || file.endsWith("BUILD_ID");
    },
    pidAlive(pid: number) {
      return alive.has(pid);
    },
    processIdentity() {
      return null;
    },
    acquireStartLock() {
      return true;
    },
    releaseStartLock() {},
    async waitUntilListening() {
      return true;
    },
    listenAddresses() {
      return [] as string[];
    },
    diskFreeBytes() {
      return 40 * 1024 * 1024 * 1024;
    },
    command(name: string) {
      if (name === "node") return { ok: true, version: "v22.14.0" };
      return { ok: true, version: `${name} 1` };
    },
    async engineHealthy() {
      return true;
    },
    weightsPresent() {
      return true;
    },
    buildPresent() {
      return true;
    },
    exec(command: string, args: string[]) {
      io.execs.push([command, ...args]);
      return { code: 0 };
    },
    spawnSupervisor() {
      io.spawned += 1;
      alive.add(4242);
      return 4242;
    },
    async supervise() {
      io.supervised += 1;
      return 0;
    },
    signal(pid: number) {
      alive.delete(pid);
    },
    openUrl() {},
    isTty() {
      return false;
    },
    prompt() {
      return "n";
    },
    sleep() {},
    logText() {
      return "engine ready\napp ready\n";
    },
    followLogs() {},
    ...overrides,
  };
  return io;
}

describe("parseArgs", () => {
  it("lists every command", () => {
    for (const command of commands) {
      const parsed = parseArgs([command]);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.command).toBe(command);
    }
  });

  it("rejects an unknown command and an unknown flag", () => {
    const unknown = parseArgs(["explode"]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toMatch(/Unknown command/);
    const flag = parseArgs(["start", "--lan"]);
    expect(flag.ok).toBe(false);
  });

  it("reads start and uninstall flags", () => {
    const start = parseArgs(["start", "--no-open", "--foreground"]);
    expect(start.ok).toBe(true);
    if (start.ok) {
      expect(start.flags.noOpen).toBe(true);
      expect(start.flags.foreground).toBe(true);
    }
    const logs = parseArgs(["logs", "-f"]);
    expect(logs.ok).toBe(true);
    if (logs.ok) expect(logs.flags.follow).toBe(true);
    const remove = parseArgs(["uninstall", "--delete-data", "--delete-weights"]);
    expect(remove.ok).toBe(true);
    if (remove.ok) {
      expect(remove.flags.deleteData).toBe(true);
      expect(remove.flags.deleteWeights).toBe(true);
    }
  });

  it("prints usage when the command is missing", () => {
    const parsed = parseArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.exitCode).toBe(1);
      expect(parsed.message).toMatch(/wavesmith start/);
    }
  });
});

describe("pid and ports", () => {
  it("round-trips a pid file and ignores garbage", () => {
    const raw = serializePid({
      supervisorPid: 10,
      enginePid: 11,
      appPid: null,
      port: 3000,
      startedAt: "t",
      engineStartedAt: "e",
      appStartedAt: null,
    });
    expect(parsePid(raw)?.supervisorPid).toBe(10);
    expect(parsePid(raw)?.engineStartedAt).toBe("e");
    expect(parsePid('{"supervisorPid":1,"port":3000,"startedAt":"t"}')?.appStartedAt).toBeNull();
    expect(parsePid("nope")).toBeNull();
    expect(parsePid(null)).toBeNull();
  });

  it("does not start a second copy, and refuses a port open on every network", () => {
    expect(
      decideStart({
        record: {
          supervisorPid: 5,
          enginePid: null,
          appPid: null,
          port: 3000,
          startedAt: "",
          engineStartedAt: null,
          appStartedAt: null,
        },
        supervisorAlive: true,
        listeners: ["127.0.0.1"],
        port: 3000,
      }).action,
    ).toBe("already");
    const refused = decideStart({
      record: null,
      supervisorAlive: false,
      listeners: ["0.0.0.0"],
      port: 3000,
    });
    expect(refused.action).toBe("refuse");
    if (refused.action === "refuse") expect(refused.fix).toMatch(/127\.0\.0\.1/);
    expect(
      decideStart({ record: null, supervisorAlive: false, listeners: [], port: 3000 }).action,
    ).toBe("start");
  });

  it("reads loopback and wildcard listeners", () => {
    expect(assessPort(3000, ["127.0.0.1"]).ok).toBe(true);
    expect(assessPort(8001, []).ok).toBe(true);
    expect(assessPort(3000, ["*"]).ok).toBe(false);
    expect(assessPort(3000, ["::"]).fix).toMatch(/127\.0\.0\.1/);
    const proc = parseProcNet(" 0: 0100007F:0BB8 00000000:0000 0A 0 0 0 0\n", "v4");
    expect(addressesOnPort(proc, 3000)).toEqual(["127.0.0.1"]);
    const any = parseProcNet(" 0: 00000000:0BB8 00000000:0000 0A 0 0 0 0\n", "v4");
    expect(addressesOnPort(any, 3000)).toEqual(["0.0.0.0"]);
    expect(parseSs("LISTEN 0 511 127.0.0.1:3000 0.0.0.0:*\n").map((row) => row.address)).toEqual([
      "127.0.0.1",
    ]);
    expect(parseLsof("node 1 user 23u IPv4 TCP *:3000 (LISTEN)\n")[0]?.address).toBe("*");
    expect(portFrom({})).toBe(3000);
    expect(portFrom({ PORT: "3100" })).toBe(3100);
    expect(portFrom({ PORT: "nope" })).toBe(3000);
  });
});

describe("doctor", () => {
  const okCommand = { ok: true, version: "v22.14.0" };
  const base = {
    commands: {
      brew: { ok: true, version: "Homebrew 4" },
      node: okCommand,
      pnpm: { ok: true, version: "pnpm 10" },
      uv: { ok: true, version: "uv 0.11.21" },
      ffmpeg: { ok: true, version: "ffmpeg 7" },
      python312: { ok: true, version: "Python 3.12.0" },
      git: { ok: true, version: "git 2" },
    },
    diskFreeBytes: 40 * 1024 * 1024 * 1024,
    weightsPresent: true,
    port3000: ["127.0.0.1"] as string[],
    port8001: [] as string[],
    engineHealthy: false,
  };

  it("accepts Node 22 and Node 26", () => {
    expect(nodeMajor("v22.14.0")).toBe(22);
    expect(nodeMajor("v26.3.0")).toBe(26);
    expect(doctorFailed(doctorChecks(base))).toBe(false);
  });

  it("gives a fix for every failure", () => {
    const checks = doctorChecks({
      ...base,
      commands: {
        ...base.commands,
        brew: { ok: false, version: "" },
        node: { ok: true, version: "v18.20.0" },
        ffmpeg: { ok: false, version: "" },
      },
      diskFreeBytes: 1024,
      weightsPresent: false,
      port3000: ["0.0.0.0"],
      port8001: ["127.0.0.1"],
      engineHealthy: false,
    });
    const failed = checks.filter((check) => !check.ok);
    expect(failed.length).toBeGreaterThan(0);
    for (const check of failed) {
      expect(check.fix && check.fix.length > 0).toBe(true);
    }
    expect(failed.map((check) => check.name)).toEqual(
      expect.arrayContaining(["Homebrew", "Node.js", "ffmpeg", "Disk space", "Model weights", "App port 3000", "Engine health"]),
    );
  });
});

describe("run", () => {
  it("does not spawn when a supervisor is already alive", async () => {
    const io = fakeIo();
    io.written[`${io.stateDir}/wavesmith.pid`] = serializePid({
      supervisorPid: 7,
      enginePid: null,
      appPid: null,
      port: 3000,
      startedAt: "sup",
      engineStartedAt: null,
      appStartedAt: null,
    });
    io.processIdentity = (pid) =>
      pid === 7 ? { command: "node cli/main.ts __supervise", startedAt: "sup", executable: "/usr/bin/node" } : null;
    const code = await run(["start"], io);
    expect(code).toBe(0);
    expect(io.spawned).toBe(0);
    expect(io.out).toMatch(/already running/);
    expect(io.out).toMatch(/127\.0\.0\.1:3000/);
  });

  it("starts one supervisor when the port is free", async () => {
    const io = fakeIo();
    const code = await run(["start", "--no-open"], io);
    expect(code).toBe(0);
    expect(io.spawned).toBe(1);
    expect(io.out).toMatch(/127\.0\.0\.1:3000/);
  });

  it("refuses to bind when port 3000 is open on every network", async () => {
    const io = fakeIo({
      listenAddresses: () => ["0.0.0.0"],
    });
    const code = await run(["start"], io);
    expect(code).toBe(1);
    expect(io.spawned).toBe(0);
    expect(io.err).toMatch(/127\.0\.0\.1/);
  });

  it("stops the recorded processes", async () => {
    const io = fakeIo();
    io.written[`${io.stateDir}/wavesmith.pid`] = serializePid({
      supervisorPid: 9,
      enginePid: 10,
      appPid: 11,
      port: 3000,
      startedAt: "sup",
      engineStartedAt: "eng",
      appStartedAt: "app",
    });
    io.processIdentity = (pid) => {
      if (pid === 9) return { command: "node cli/main.ts __supervise", startedAt: "sup", executable: "/usr/bin/node" };
      if (pid === 10) return { command: "uv run acestep-api --host 127.0.0.1", startedAt: "eng", executable: "/usr/bin/uv" };
      if (pid === 11) return { command: "pnpm exec next start --hostname 127.0.0.1", startedAt: "app", executable: "/usr/bin/pnpm" };
      return null;
    };
    const living = new Set([9, 10, 11]);
    io.pidAlive = (pid) => living.has(pid);
    io.signal = (pid) => living.delete(pid);
    expect(await run(["stop"], io)).toBe(0);
    expect(io.out).toMatch(/stopped/);
    expect(living.size).toBe(0);
  });

  it("updates without deleting songs or .env", async () => {
    const io = fakeIo();
    expect(await run(["update"], io)).toBe(0);
    expect(io.execs).toEqual(updateCommands());
    expect(io.spawned).toBe(0);
    expect(io.removed.some((file) => file.endsWith("/data") || file.endsWith("/.env"))).toBe(false);
    expect(JSON.stringify(io.execs)).not.toMatch(/data\/|\.env/);
  });

  it("keeps songs and models when uninstall is not a conversation", async () => {
    const io = fakeIo();
    expect(await run(["uninstall"], io)).toBe(0);
    expect(io.removed).not.toContain("/Users/ada/Wavesmith/data");
    expect(io.removed).not.toContain("/Users/ada/Wavesmith/engine");
    expect(io.removed).not.toContain("/Users/ada/Wavesmith");
    expect(io.removed).toContain(io.stateDir);
    expect(io.execs[0]).toEqual([
      "launchctl",
      "bootout",
      "gui/501",
      "/Users/ada/Library/LaunchAgents/com.wavesmith.login.plist",
    ]);
    expect(io.out).toMatch(/data/);
    expect(io.out).toMatch(/folder stays/);
    const plan = planUninstall({
      root: "/Users/ada/Wavesmith",
      home: "/Users/ada",
      stateDir: "/Users/ada/Library/Application Support/Wavesmith",
      deleteData: false,
      deleteWeights: false,
      dataDir: "/Users/ada/Wavesmith/data",
      engineDir: "/Users/ada/Wavesmith/engine/ACE-Step-1.5",
    });
    expect(plan.keep).toEqual(
      expect.arrayContaining([
        "/Users/ada/Wavesmith/data",
        "/Users/ada/Wavesmith/.env",
        "/Users/ada/Wavesmith/engine/ACE-Step-1.5",
      ]),
    );
    expect(plan.remove).not.toContain("/Users/ada/Wavesmith");
  });

  it("writes a login item with no secrets", async () => {
    const io = fakeIo();
    expect(await run(["login", "on"], io)).toBe(0);
    const plist = io.written["/Users/ada/Library/LaunchAgents/com.wavesmith.login.plist"] ?? "";
    expect(plist).toMatch(/wavesmith-login\.sh/);
    expect(plist).not.toMatch(/XAI_API_KEY|EnvironmentVariables|BEGIN/);
    expect(renderLaunchAgent("/tmp/wavesmith-login.sh")).not.toMatch(/secret-token/);
    expect(io.out).toMatch(/starts now, and again each time you log in/);
  });

  it("doctor prints fixes from the fake machine", async () => {
    const io = fakeIo({
      command: (name) => (name === "brew" ? { ok: false, version: "" } : { ok: true, version: "v22.0.0" }),
      weightsPresent: () => false,
    });
    expect(await run(["doctor"], io)).toBe(1);
    expect(io.out).toMatch(/Fix: /);
  });
});

describe("env file", () => {
  it("keeps values for child processes and forces loopback", () => {
    const parsed = loadEnvFile("# comment\nXAI_API_KEY=secret-token\nPORT=3000\n");
    expect(parsed.XAI_API_KEY).toBe("secret-token");
    const env = childEnv("HOSTNAME=0.0.0.0\nMOCK_ENGINE=0\nPORT=3000\n", {
      PATH: "/usr/bin",
      MOCK_ENGINE: "1",
    });
    expect(env.HOSTNAME).toBe("127.0.0.1");
    expect(env.MOCK_ENGINE).toBe("1");
    expect(env.PORT).toBe("3000");
    expect(lastLines("a\nb\nc\n", 2)).toBe("b\nc");
  });
});

describe("process identity", () => {
  it("reads a start tick after the comm field", () => {
    const fields = ["S", "1", "1", "1", "0", "-1", "0", "0", "0", "0", "0", "0", "0", "0", "20", "0", "1", "0", "0", "424242"];
    expect(parseProcStatStart(`42 (cli/main.ts) ${fields.join(" ")}`)).toBe("424242");
    expect(parseProcStatStart(`7 (next (server)) ${fields.join(" ").replace("424242", "99")}`)).toBe("99");
    expect(parseBtime("cpu 1\nbtime 1700000000\n")).toBe("1700000000");
    expect(parseProcStatStart(fs.readFileSync("/proc/self/stat", "utf8"))).toMatch(/^\d+$/);
    expect(parseKernProcStart("p_starttime = { tv_sec = 1700000000 tv_usec = 42 }")).toBe("1700000000.000042");
  });

  it("does not treat a renamed argv string as Wavesmith", () => {
    const spoof = "node --experimental-strip-types cli/main.ts __supervise";
    expect(
      isOurProcess({
        expectedStartedAt: "100:200",
        marker: SUPERVISOR_MARKER,
        actual: { command: `${spoof}\0`, startedAt: "100:200", executable: "/usr/bin/node" },
      }),
    ).toBe(false);
    expect(
      isOurProcess({
        expectedStartedAt: "100:200",
        marker: SUPERVISOR_MARKER,
        actual: { command: `${spoof}\0`, startedAt: "100:200", executable: "/usr/bin/sleep" },
      }),
    ).toBe(false);
    expect(
      isOurProcess({
        expectedStartedAt: "100:200",
        marker: "next",
        actual: { command: "next start --hostname 127.0.0.1", startedAt: "100:200", executable: "/bin/sleep" },
      }),
    ).toBe(false);
    expect(
      isOurProcess({
        expectedStartedAt: "100:200",
        marker: SUPERVISOR_MARKER,
        actual: {
          command: "/usr/bin/node\0--experimental-strip-types\0/workspace/cli/main.ts\0__supervise",
          startedAt: "100:200",
          executable: "/usr/bin/node",
        },
      }),
    ).toBe(true);
  });

  it("does not kill a process that only borrowed the supervisor name", async () => {
    const child = spawn("bash", ["-c", "exec -a 'node --experimental-strip-types cli/main.ts __supervise' sleep 60"], {
      detached: true,
      stdio: "ignore",
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const identity = readProcessIdentity(child.pid as number);
    expect(identity).not.toBeNull();
    expect(
      isOurProcess({
        expectedStartedAt: identity?.startedAt ?? "",
        marker: SUPERVISOR_MARKER,
        actual: identity,
      }),
    ).toBe(false);
    const io = fakeIo();
    io.written[`${io.stateDir}/wavesmith.pid`] = serializePid({
      supervisorPid: child.pid as number,
      enginePid: null,
      appPid: null,
      port: 3000,
      startedAt: identity?.startedAt ?? "",
      engineStartedAt: null,
      appStartedAt: null,
    });
    io.processIdentity = (asked) => (asked === child.pid ? readProcessIdentity(asked) : null);
    const signaled: number[] = [];
    io.signal = (pid) => signaled.push(pid);
    expect(await run(["stop"], io)).toBe(0);
    expect(signaled).toEqual([]);
    try {
      process.kill(child.pid as number, "SIGKILL");
    } catch {
      // Already gone.
    }
    child.unref();
  });

  it("rejects a mismatched command or start time", () => {
    const actual = { command: "sleep 300", startedAt: "100:200" };
    expect(isOurProcess({ expectedStartedAt: "100:200", marker: "cli/main.ts", actual })).toBe(false);
    expect(
      isOurProcess({
        expectedStartedAt: "100:1",
        marker: "cli/main.ts",
        actual: { command: "node cli/main.ts __supervise", startedAt: "100:200" },
      }),
    ).toBe(false);
    expect(
      isOurProcess({
        expectedStartedAt: "100:200",
        marker: "cli/main.ts",
        actual: { command: "node cli/main.ts __supervise", startedAt: "100:200", executable: "" },
      }),
    ).toBe(false);
    expect(
      isOurProcess({
        expectedStartedAt: "100:200",
        marker: "cli/main.ts",
        actual: { command: "node cli/main.ts __supervise", startedAt: "100:200" },
      }),
    ).toBe(false);
    expect(
      isOurProcess({
        expectedStartedAt: "100:200",
        marker: "cli/main.ts",
        actual: { command: "node cli/main.ts __supervise", startedAt: "100:200", executable: "/usr/bin/node" },
      }),
    ).toBe(true);
    expect(isOurProcess({ expectedStartedAt: "", marker: "cli/main.ts", actual })).toBe(false);
    expect(isOurProcess({ expectedStartedAt: "100:200", marker: "cli/main.ts", actual: null })).toBe(false);
  });

  it("does not kill a live unrelated process, and does not call it Wavesmith", async () => {
    const child = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
    const pid = child.pid;
    expect(pid).toBeTruthy();
    const identity = readProcessIdentity(pid as number);
    expect(identity?.command).toMatch(/sleep/);
    const io = fakeIo();
    io.written[`${io.stateDir}/wavesmith.pid`] = serializePid({
      supervisorPid: pid as number,
      enginePid: pid as number,
      appPid: null,
      port: 3000,
      startedAt: identity?.startedAt ?? "missing",
      engineStartedAt: identity?.startedAt ?? "missing",
      appStartedAt: null,
    });
    io.processIdentity = (asked) => (asked === pid ? readProcessIdentity(asked) : null);
    io.pidAlive = () => true;
    const signaled: number[] = [];
    io.signal = (target) => signaled.push(target);
    expect(await run(["stop"], io)).toBe(0);
    expect(signaled).toEqual([]);
    expect(io.out).toMatch(/not running/);
    expect(() => process.kill(pid as number, 0)).not.toThrow();

    const start = fakeIo();
    start.written[`${start.stateDir}/wavesmith.pid`] = io.written[`${io.stateDir}/wavesmith.pid`] ?? "";
    start.processIdentity = io.processIdentity;
    start.pidAlive = () => true;
    expect(await run(["start", "--no-open"], start)).toBe(0);
    expect(start.out).not.toMatch(/already running/);
    expect(start.spawned).toBe(1);
    process.kill(pid as number, "SIGKILL");
    child.unref();
  });

  it("does not signal when the start time changed under the same command", async () => {
    const io = fakeIo();
    io.written[`${io.stateDir}/wavesmith.pid`] = serializePid({
      supervisorPid: 9,
      enginePid: null,
      appPid: null,
      port: 3000,
      startedAt: "100:1",
      engineStartedAt: null,
      appStartedAt: null,
    });
    io.processIdentity = () => ({ command: "node cli/main.ts __supervise", startedAt: "100:999" });
    io.pidAlive = () => true;
    const signaled: number[] = [];
    io.signal = (pid) => signaled.push(pid);
    expect(await run(["stop"], io)).toBe(0);
    expect(signaled).toEqual([]);
  });

  it("does not SIGKILL a pid that was reused after SIGTERM", async () => {
    const io = fakeIo();
    io.written[`${io.stateDir}/wavesmith.pid`] = serializePid({
      supervisorPid: 9,
      enginePid: null,
      appPid: null,
      port: 3000,
      startedAt: "sup",
      engineStartedAt: null,
      appStartedAt: null,
    });
    let checks = 0;
    io.processIdentity = () => {
      checks += 1;
      if (checks > 1) return { command: "sleep 60", startedAt: "other" };
      return { command: "node cli/main.ts __supervise", startedAt: "sup", executable: "/usr/bin/node" };
    };
    io.pidAlive = () => true;
    const signals: string[] = [];
    io.signal = (_pid, signal) => signals.push(signal);
    expect(await run(["stop"], io)).toBe(0);
    expect(signals).toEqual(["SIGTERM"]);
  });
});

describe("start lock and update", () => {
  it("lets only one mkdir lock win", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-lock-"));
    const lock = path.join(dir, "start.lock");
    expect(tryAcquireLock(lock)).toBe(true);
    expect(tryAcquireLock(lock)).toBe(false);
    releaseLock(lock);
    expect(tryAcquireLock(lock)).toBe(true);
    releaseLock(lock);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("two processes cannot both take the start lock", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-lock-race-"));
    const lock = path.join(dir, "start.lock");
    const script = `
      import { tryAcquireLock } from ${JSON.stringify(path.join(process.cwd(), "cli/lock.ts"))};
      process.stdout.write(tryAcquireLock(process.argv[1]) ? "yes" : "no");
    `;
    const runOne = () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, lock], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
          err += chunk.toString("utf8");
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code !== 0) reject(new Error(err || `lock racer exited ${code}`));
          else resolve(out);
        });
      });
    const [first, second] = await Promise.all([runOne(), runOne()]);
    expect([first, second].sort()).toEqual(["no", "yes"]);
    releaseLock(lock);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("a second start does not spawn while the lock is held", async () => {
    const io = fakeIo();
    io.acquireStartLock = () => false;
    expect(await run(["start"], io)).toBe(1);
    expect(io.spawned).toBe(0);
    expect(io.err).toMatch(/already starting/);
  });

  it("steals a lock whose owner is not Wavesmith", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-stale-lock-"));
    const lock = path.join(dir, "start.lock");
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "owner"), JSON.stringify({ pid: 4242, startedAt: "old" }));
    const took = takeStartLock({
      dir: lock,
      ownerPid: process.pid,
      ownerStartedAt: "now",
      identity: () => ({ command: "sleep 60", startedAt: "old" }),
    });
    expect(took).toBe(true);
    releaseLock(lock);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stops a running app before update and starts it again", async () => {
    const io = fakeIo();
    io.written[`${io.stateDir}/wavesmith.pid`] = serializePid({
      supervisorPid: 9,
      enginePid: 10,
      appPid: 11,
      port: 3000,
      startedAt: "sup",
      engineStartedAt: "eng",
      appStartedAt: "app",
    });
    io.processIdentity = (pid) => {
      if (pid === 9) return { command: "node cli/main.ts __supervise", startedAt: "sup", executable: "/usr/bin/node" };
      if (pid === 10) return { command: "acestep-api --host 127.0.0.1", startedAt: "eng", executable: "/usr/bin/acestep-api" };
      if (pid === 11) return { command: "next start --hostname 127.0.0.1", startedAt: "app", executable: "/usr/bin/node" };
      return null;
    };
    const signaled: number[] = [];
    io.signal = (pid) => signaled.push(pid);
    expect(await run(["update"], io)).toBe(0);
    expect(signaled).toEqual(expect.arrayContaining([9, 10, 11]));
    expect(io.execs).toEqual(updateCommands());
    expect(io.spawned).toBe(1);
    expect(io.out).toMatch(/Stopping Wavesmith/);
    expect(io.out).toMatch(/Starting Wavesmith again/);
    expect(JSON.stringify(io.execs)).not.toMatch(/\.env/);
  });
});

describe("uninstall leftovers", () => {
  it("boots out the login item even when launchctl fails", async () => {
    const io = fakeIo();
    io.exec = (command, args) => {
      io.execs.push([command, ...args]);
      return { code: command === "launchctl" ? 1 : 0 };
    };
    expect(await run(["uninstall"], io)).toBe(0);
    expect(io.execs.some((row) => row[0] === "launchctl" && row[1] === "bootout")).toBe(true);
  });

  it("removes the PATH lines and the configured data and engine directories", async () => {
    const io = fakeIo();
    io.platform = "linux";
    io.written[`${io.root}/.env`] = "DATA_DIR=/Users/ada/Wavesmith/data\nENGINE_DIR=/Users/ada/Wavesmith/engine/ACE-Step-1.5\n";
    io.written[`${io.home}/.zprofile`] = 'export A=1\n# Wavesmith\nexport PATH="$HOME/.local/bin:$PATH"\nexport B=2\n';
    io.written[`${io.home}/.bash_profile`] = "# Wavesmith\nexport PATH=\"$HOME/.local/bin:$PATH\"\n";
    expect(await run(["uninstall", "--delete-data", "--delete-weights"], io)).toBe(0);
    expect(io.removed).toContain("/Users/ada/Wavesmith/data");
    expect(io.removed).toContain("/Users/ada/Wavesmith/engine/ACE-Step-1.5");
    expect(io.removed).not.toContain("/Users/ada/Wavesmith/songs");
    expect(io.removed).not.toContain("/Users/ada/Wavesmith");
    expect(io.removed).not.toContain(`${io.root}/.env`);
    expect(io.execs.some((row) => row[0] === "launchctl")).toBe(false);
    expect(io.written[`${io.home}/.zprofile`]).toBe("export A=1\nexport B=2\n");
    expect(io.written[`${io.home}/.bash_profile`]).not.toMatch(/Wavesmith/);
    expect(
      resolveConfiguredDir("/Users/ada/Wavesmith", "DATA_DIR=./library\n", "DATA_DIR", "data", {}),
    ).toBe("/Users/ada/Wavesmith/library");
    expect(stripWavesmithPath("keep\n# Wavesmith\nexport PATH=\"$HOME/.local/bin:$PATH\"\n")).toBe("keep\n");
  });

  it("refuses to delete /, home, an ancestor, a symlink to home, or a .. path", async () => {
    const ancestor = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-home-"));
    const home = path.join(ancestor, "ada");
    const root = path.join(home, "Wavesmith");
    fs.mkdirSync(root, { recursive: true });
    const link = path.join(ancestor, "link-home");
    fs.symlinkSync(home, link);
    const cases: { key: "DATA_DIR" | "ENGINE_DIR" | "WAVESMITH_STATE_DIR"; value: string; flags: string[] }[] = [];
    for (const key of ["DATA_DIR", "ENGINE_DIR", "WAVESMITH_STATE_DIR"] as const) {
      const flags = key === "DATA_DIR" ? ["--delete-data"] : key === "ENGINE_DIR" ? ["--delete-weights"] : [];
      cases.push(
        { key, value: "/", flags },
        { key, value: home, flags },
        { key, value: ancestor, flags },
        { key, value: link, flags },
        { key, value: `${root}/../../..`, flags },
      );
    }
    try {
      for (const item of cases) {
        const io = fakeIo();
        io.home = home;
        io.root = root;
        io.stateDir = path.join(home, "Library", "Application Support", "Wavesmith");
        io.env = { ...io.env, [item.key]: item.value };
        const code = await run(["uninstall", ...item.flags], io);
        expect(code, `${item.key}=${item.value}`).toBe(1);
        expect(io.removed, `${item.key}=${item.value}`).not.toContain("/");
        expect(io.removed, `${item.key}=${item.value}`).not.toContain(home);
        expect(io.removed, `${item.key}=${item.value}`).not.toContain(ancestor);
        expect(io.removed, `${item.key}=${item.value}`).not.toContain(link);
        expect(io.removed, `${item.key}=${item.value}`).not.toContain(item.value);
        expect(io.err, `${item.key}=${item.value}`).toMatch(/Refusing to delete/);
        expect(fs.existsSync(home)).toBe(true);
      }
      const marked = path.join(ancestor, "songs");
      fs.mkdirSync(marked);
      fs.writeFileSync(path.join(marked, "setup-progress.json"), installerProgress());
      fs.writeFileSync(path.join(marked, "root"), "/some/path\n");
      const markedIo = fakeIo();
      markedIo.home = home;
      markedIo.root = root;
      markedIo.stateDir = path.join(home, "Library", "Application Support", "Wavesmith");
      markedIo.env = { ...markedIo.env, DATA_DIR: marked };
      expect(hasWavesmithMarker(marked)).toBe(true);
      expect(await run(["uninstall", "--delete-data"], markedIo)).toBe(1);
      expect(markedIo.removed).not.toContain(marked);
      const inside = path.join(home, "Music");
      fs.mkdirSync(inside);
      fs.writeFileSync(path.join(inside, "setup-progress.json"), installerProgress());
      const insideIo = fakeIo();
      insideIo.home = home;
      insideIo.root = root;
      insideIo.stateDir = path.join(home, "Library", "Application Support", "Wavesmith");
      insideIo.env = { ...insideIo.env, DATA_DIR: inside };
      expect(await run(["uninstall", "--delete-data"], insideIo)).toBe(0);
      expect(insideIo.removed).toContain(inside);
      const weak = path.join(ancestor, "weak");
      fs.mkdirSync(weak);
      fs.writeFileSync(path.join(weak, "setup-progress.json"), "{\"running\":false}");
      fs.writeFileSync(path.join(weak, "root"), "/Users/ada/Wavesmith\n");
      expect(hasWavesmithMarker(weak)).toBe(false);
      const weakIo = fakeIo();
      weakIo.home = home;
      weakIo.root = root;
      weakIo.stateDir = path.join(home, "Library", "Application Support", "Wavesmith");
      weakIo.env = { ...weakIo.env, DATA_DIR: weak };
      expect(await run(["uninstall", "--delete-data"], weakIo)).toBe(1);
      expect(weakIo.removed).not.toContain(weak);
      expect(classifyDelete("/", { home, root, env: {} }).ok).toBe(false);
    } finally {
      fs.rmSync(ancestor, { recursive: true, force: true });
    }
  });

  it("refuses system directories and outside-home trees on a fake root", () => {
    expect(isDeniedSystemPath("/opt/local", ["/opt/local/wavesmith"])).toBe(true);
    expect(isDeniedSystemPath("/Users/ada/Wavesmith", [])).toBe(false);
    for (const name of ["home", "root", "mnt", "srv", "boot"]) {
      expect(isDeniedSystemPath(`/${name}`, []), name).toBe(true);
    }

    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-fakeroot-"));
    const home = "/Users/ada";
    const install = "/Users/ada/Wavesmith";
    const layout = [
      ...SYSTEM_DIR_NAMES.map((name) => name),
      "private/tmp",
      "private/var",
      "private/etc",
      "usr/local",
      "opt/homebrew",
      "Library/Application Support",
      "System/Library",
      "var/folders/xx",
      "Users/ada/Wavesmith/data",
      "Users/ada/Wavesmith/engine/ACE-Step-1.5/checkpoints",
      "Users/ada/Library/Application Support/Wavesmith",
      "Users/ada/Music/Custom",
    ];
    for (const rel of layout) fs.mkdirSync(path.join(fakeRoot, rel), { recursive: true });
    const io = fakeDeleteIO(fakeRoot);
    const ctx = { home, root: install, env: {} as Record<string, string | undefined>, io };
    try {
      for (const name of SYSTEM_DIR_NAMES) {
        const dir = `/${name}`;
        expect(classifyDelete(dir, ctx).ok, `${dir} without a marker`).toBe(false);
        writeFakeMarker(fakeRoot, dir);
        expect(hasWavesmithMarker(dir, io), dir).toBe(true);
        const planted = classifyDelete(dir, { ...ctx, env: { DATA_DIR: dir } });
        expect(planted.ok, `${dir} with a marker`).toBe(false);
        if (name === "Users") expect(planted.message).toMatch(/home or the Wavesmith install/);
        else expect(planted.message).toMatch(/system folder/);
      }
      for (const dir of ["/private/tmp", "/private/var", "/private/etc"]) {
        writeFakeMarker(fakeRoot, dir);
        expect(classifyDelete(dir, { ...ctx, env: { DATA_DIR: dir } }).ok, dir).toBe(false);
      }
      const outside = [
        "/usr/local",
        "/opt/homebrew",
        "/Library/Application Support",
        "/System/Library",
        "/var/folders/xx",
      ];
      for (const dir of outside) {
        writeFakeMarker(fakeRoot, dir);
        expect(hasWavesmithMarker(dir, io), dir).toBe(true);
        for (const key of ["DATA_DIR", "ENGINE_DIR", "WAVESMITH_STATE_DIR"] as const) {
          const verdict = classifyDelete(dir, { ...ctx, env: { [key]: dir } });
          expect(verdict.ok, `${key}=${dir}`).toBe(false);
          expect(verdict.message, dir).toMatch(/outside your home folder/);
        }
      }
      expect(classifyDelete(`${install}/data`, ctx).ok).toBe(true);
      expect(classifyDelete(`${install}/engine/ACE-Step-1.5/checkpoints`, ctx).ok).toBe(true);
      expect(classifyDelete(`${home}/Library/Application Support/Wavesmith`, ctx).ok).toBe(true);
      const custom = `${home}/Music/Custom`;
      expect(classifyDelete(custom, { ...ctx, env: { DATA_DIR: custom } }).ok).toBe(false);
      writeFakeMarker(fakeRoot, custom);
      expect(classifyDelete(custom, { ...ctx, env: { DATA_DIR: custom } }).ok).toBe(true);
      expect(classifyDelete(install, ctx).ok).toBe(false);
      expect(fs.existsSync("/usr/local/setup-progress.json")).toBe(false);
      expect(fs.existsSync("/opt/homebrew")).toBe(false);
    } finally {
      fs.rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it("unlinks the pid and lock in a custom state dir without deleting the dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-state-"));
    const pid = path.join(dir, "wavesmith.pid");
    const lock = path.join(dir, "start.lock");
    const other = path.join(dir, "notes.txt");
    fs.writeFileSync(pid, "{}\n");
    fs.mkdirSync(lock);
    fs.writeFileSync(other, "keep\n");
    const previous = process.env.WAVESMITH_STATE_DIR;
    process.env.WAVESMITH_STATE_DIR = dir;
    const home = "/home/ada";
    const root = "/home/ada/Wavesmith";
    const env = { WAVESMITH_STATE_DIR: dir };
    try {
      expect(classifyDelete(dir, { home, root, env }).ok).toBe(false);
      expect(classifyDelete(other, { home, root, env }).ok).toBe(false);
      expect(classifyDelete(pid, { home, root, env }).ok).toBe(true);
      expect(classifyDelete(lock, { home, root, env }).ok).toBe(true);
      const io = realIo();
      io.remove(pid);
      io.remove(lock);
      io.remove(dir);
      expect(fs.existsSync(pid)).toBe(false);
      expect(fs.existsSync(lock)).toBe(false);
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.existsSync(other)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.WAVESMITH_STATE_DIR;
      else process.env.WAVESMITH_STATE_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function writeFakeMarker(fakeRoot: string, virtualDir: string): void {
  const rel = virtualDir.replace(/^\//, "");
  fs.writeFileSync(path.join(fakeRoot, rel, "setup-progress.json"), installerProgress());
}

/** Map virtual absolute paths onto a temp directory. realpath never leaves that directory. */
function fakeDeleteIO(fakeRoot: string): DeleteIO {
  const root = path.resolve(fakeRoot);
  const toHost = (virtual: string) => {
    const abs = path.posix.resolve(virtual);
    if (abs === "/") return root;
    return path.join(root, abs.slice(1));
  };
  const toVirtual = (hostPath: string) => {
    const rel = path.relative(root, path.resolve(hostPath));
    if (rel === "") return "/";
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`escaped fake root: ${hostPath}`);
    return `/${rel.split(path.sep).join("/")}`;
  };
  return {
    realpathSync(target: string) {
      return toVirtual(fs.realpathSync(toHost(target)));
    },
    statSync(target: string) {
      return fs.statSync(toHost(target));
    },
    readFileSync(target: string, encoding: "utf8") {
      return fs.readFileSync(toHost(target), encoding);
    },
  };
}
