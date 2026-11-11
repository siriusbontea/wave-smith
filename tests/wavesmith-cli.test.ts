/**
 * wavesmith's command decisions: arguments, the pid lock, ports, and doctor.
 * The machine is a fake. Nothing here binds a port or shells out.
 */
import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.ts";
import { doctorChecks, doctorFailed, nodeMajor } from "../cli/doctor.ts";
import { childEnv, loadEnvFile } from "../cli/envfile.ts";
import type { CliIo } from "../cli/io.ts";
import { renderLaunchAgent } from "../cli/launchd.ts";
import { decideStart, parsePid, portFrom, serializePid } from "../cli/pid.ts";
import { lastLines, planUninstall, updateCommands } from "../cli/plans.ts";
import { addressesOnPort, assessPort, parseLsof, parseProcNet, parseSs } from "../cli/ports.ts";
import { run } from "../cli/run.ts";

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
    });
    expect(parsePid(raw)?.supervisorPid).toBe(10);
    expect(parsePid("nope")).toBeNull();
    expect(parsePid(null)).toBeNull();
  });

  it("does not start a second copy, and refuses a port open on every network", () => {
    expect(
      decideStart({
        record: { supervisorPid: 5, enginePid: null, appPid: null, port: 3000, startedAt: "" },
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
      startedAt: "",
    });
    const original = io.pidAlive;
    io.pidAlive = (pid) => pid === 7 || original(pid);
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
      startedAt: "",
    });
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
    expect(io.removed).toEqual([]);
    expect(JSON.stringify(io.execs)).not.toMatch(/data\/|\.env/);
  });

  it("keeps songs and models when uninstall is not a conversation", async () => {
    const io = fakeIo();
    expect(await run(["uninstall"], io)).toBe(0);
    expect(io.removed).not.toContain("/Users/ada/Wavesmith/data");
    expect(io.removed).not.toContain("/Users/ada/Wavesmith/engine");
    expect(io.out).toMatch(/data/);
    const plan = planUninstall({
      root: "/Users/ada/Wavesmith",
      home: "/Users/ada",
      deleteData: false,
      deleteWeights: false,
    });
    expect(plan.keep).toEqual(expect.arrayContaining(["/Users/ada/Wavesmith/data", "/Users/ada/Wavesmith/.env", "/Users/ada/Wavesmith/engine"]));
  });

  it("writes a login item with no secrets", async () => {
    const io = fakeIo();
    expect(await run(["login", "on"], io)).toBe(0);
    const plist = io.written["/Users/ada/Library/LaunchAgents/com.wavesmith.login.plist"] ?? "";
    expect(plist).toMatch(/wavesmith-login\.sh/);
    expect(plist).not.toMatch(/XAI_API_KEY|EnvironmentVariables|BEGIN/);
    expect(renderLaunchAgent("/tmp/wavesmith-login.sh")).not.toMatch(/secret-token/);
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
