/**
 * cli/run.ts — wavesmith commands.
 * Start refuses a second copy. Update and uninstall leave songs in place
 * unless uninstall is told to delete them.
 */

import fs from "node:fs";
import { parseArgs, type Flags } from "./args.ts";
import { doctorChecks, doctorFailed, formatDoctor, type DoctorInput } from "./doctor.ts";
import { inspectGrokBuild } from "./grok-build.ts";
import { APP_MARKER, ENGINE_MARKER, SUPERVISOR_MARKER, isOurProcess } from "./identity.ts";
import type { CliIo } from "./io.ts";
import { renderLaunchAgent } from "./launchd.ts";
import { decideStart, parsePid, portFrom, type PidRecord } from "./pid.ts";
import { lastLines, planUninstall, stripWavesmithPath, updateCommands } from "./plans.ts";
import { checkoutBlocksUninstall, classifyDelete, deleteClassifyEnv } from "./uninstall-guard.ts";

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    io.stdout(parsed.message.endsWith("\n") ? parsed.message : `${parsed.message}\n`);
    return parsed.exitCode;
  }
  switch (parsed.command) {
    case "start":
      return start(io, parsed.flags);
    case "stop":
      return stop(io);
    case "status":
      return status(io);
    case "open":
      return open(io);
    case "update":
      return update(io);
    case "doctor":
      return doctor(io, parsed.flags);
    case "logs":
      return logs(io, parsed.flags.follow);
    case "uninstall":
      return uninstall(io, parsed.flags);
    case "login":
      return login(io, parsed.rest);
    case "help":
      return 0;
    default:
      return 1;
  }
}

function pidPath(io: CliIo): string {
  return `${io.stateDir}/wavesmith.pid`;
}

function dataDir(io: CliIo): string {
  const raw = io.env.DATA_DIR || `${io.root}/data`;
  if (raw.startsWith("/")) return raw;
  return `${io.root}/${raw.replace(/^\.\//, "")}`;
}

function appUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

interface OwnedProcess {
  pid: number;
  startedAt: string;
  marker: string;
}

function matches(io: CliIo, pid: number, startedAt: string, marker: string): boolean {
  return isOurProcess({
    expectedStartedAt: startedAt,
    marker,
    actual: io.processIdentity(pid),
  });
}

function supervisorMatches(io: CliIo, record: PidRecord | null): boolean {
  if (!record) return false;
  return matches(io, record.supervisorPid, record.startedAt, SUPERVISOR_MARKER);
}

/** Verified processes only. A stale pid is left out and must not be signalled. */
function ownedProcesses(io: CliIo, record: PidRecord | null): OwnedProcess[] {
  if (!record) return [];
  const out: OwnedProcess[] = [];
  const push = (pid: number | null, startedAt: string | null, marker: string) => {
    if (!pid || !startedAt) return;
    if (!matches(io, pid, startedAt, marker)) return;
    out.push({ pid, startedAt, marker });
  };
  push(record.supervisorPid, record.startedAt, SUPERVISOR_MARKER);
  push(record.enginePid, record.engineStartedAt, ENGINE_MARKER);
  push(record.appPid, record.appStartedAt, APP_MARKER);
  return out;
}

function setupRunning(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw) as { running?: unknown };
    return value.running === true;
  } catch {
    return false;
  }
}

async function start(io: CliIo, flags: Flags): Promise<number> {
  if (!io.acquireStartLock()) {
    io.stderr("Wavesmith is already starting.\nFix: wait a moment, then run wavesmith status\n");
    return 1;
  }
  try {
    const port = portFrom(io.env);
    const record = parsePid(io.readText(pidPath(io)));
    const ours = supervisorMatches(io, record);
    if (record && !ours) io.remove(pidPath(io));
    const decision = decideStart({
      record: ours ? record : null,
      supervisorAlive: ours,
      listeners: io.listenAddresses(port),
      port,
    });
    if (decision.action === "already") {
      io.stdout(`Wavesmith is already running at ${appUrl(decision.port)}\n`);
      if (!flags.noOpen) io.openUrl(appUrl(decision.port));
      return 0;
    }
    if (decision.action === "refuse") {
      io.stderr(`${decision.message}\nFix: ${decision.fix}\n`);
      return 1;
    }

    const mock = io.env.MOCK_ENGINE === "1";
    const engineReady = io.exists(`${io.root}/engine/ACE-Step-1.5/.venv`);
    const setupIsRunning = setupRunning(io.readText(`${dataDir(io)}/setup-progress.json`));
    if (!mock && !engineReady && !setupIsRunning) {
      io.stderr("The music engine is not installed yet.\nFix: run the installer again.\n");
      return 1;
    }
    if (!io.buildPresent() && io.env.WAVESMITH_SKIP_BUILD !== "1") {
      io.stdout("Building Wavesmith. This takes a minute.\n");
      const built = io.exec("pnpm", ["build"]);
      if (built.code !== 0) {
        io.stderr("The build failed.\nFix: run wavesmith doctor\n");
        return built.code || 1;
      }
    }
    if (flags.foreground) return await io.supervise({ noOpen: flags.noOpen });
    const pid = io.spawnSupervisor({
      PORT: String(port),
      WAVESMITH_NO_OPEN: flags.noOpen ? "1" : "0",
      WAVESMITH_SKIP_ENGINE: mock || !engineReady ? "1" : "0",
      WAVESMITH_STATE_DIR: io.stateDir,
      WAVESMITH_ROOT: io.root,
    });
    if (!pid) {
      io.stderr("Couldn't start Wavesmith in the background.\nFix: run wavesmith doctor\n");
      return 1;
    }
    const ready = await io.waitUntilListening(port, 120_000);
    if (!ready) {
      io.stderr("Wavesmith is still starting.\nFix: run wavesmith logs\n");
      return 1;
    }
    io.stdout(`Wavesmith is ready at ${appUrl(port)}\n`);
    return 0;
  } finally {
    io.releaseStartLock();
  }
}

function stop(io: CliIo): number {
  const record = parsePid(io.readText(pidPath(io)));
  const targets = ownedProcesses(io, record);
  if (targets.length === 0) {
    io.remove(pidPath(io));
    io.stdout("Wavesmith is not running.\n");
    return 0;
  }
  for (const target of targets) io.signal(target.pid, "SIGTERM");
  for (let i = 0; i < 25; i += 1) {
    if (targets.every((target) => !io.pidAlive(target.pid))) break;
    io.sleep(200);
  }
  for (const target of targets) {
    if (!io.pidAlive(target.pid)) continue;
    if (!matches(io, target.pid, target.startedAt, target.marker)) continue;
    io.signal(target.pid, "SIGKILL");
  }
  io.remove(pidPath(io));
  io.stdout("Wavesmith stopped.\n");
  return 0;
}

function status(io: CliIo): number {
  const port = portFrom(io.env);
  const record = parsePid(io.readText(pidPath(io)));
  const running = supervisorMatches(io, record);
  if (!running) {
    io.stdout("Wavesmith is not running.\nStart it with: wavesmith start\n");
    return 0;
  }
  const listen = io.listenAddresses(record?.port ?? port);
  io.stdout("Wavesmith is running.\n");
  io.stdout(`App    ${appUrl(record?.port ?? port)}\n`);
  io.stdout(
    listen.length === 0
      ? "The app port is not open yet.\n"
      : `Listening on ${listen.join(", ")}.\n`,
  );
  return 0;
}

function open(io: CliIo): number {
  const record = parsePid(io.readText(pidPath(io)));
  const port = record?.port ?? portFrom(io.env);
  if (!supervisorMatches(io, record)) {
    io.stderr("Wavesmith is not running.\nFix: wavesmith start\n");
    return 1;
  }
  io.openUrl(appUrl(port));
  io.stdout(`Opening ${appUrl(port)}\n`);
  return 0;
}

async function update(io: CliIo): Promise<number> {
  const wasRunning = supervisorMatches(io, parsePid(io.readText(pidPath(io))));
  if (wasRunning) {
    io.stdout("Stopping Wavesmith before the update. Your songs, data/, and .env stay where they are.\n");
    stop(io);
  } else {
    io.stdout("Updating Wavesmith. Your songs, data/, and .env stay where they are.\n");
  }
  for (const [command, ...args] of updateCommands()) {
    if (!command) continue;
    io.stdout(`\n$ ${[command, ...args].join(" ")}\n`);
    const result = io.exec(command, args);
    if (result.code !== 0) {
      io.stderr(`That step failed (${command}).\nFix: run wavesmith doctor\n`);
      return result.code || 1;
    }
  }
  if (wasRunning) {
    io.stdout("\nStarting Wavesmith again.\n");
    return start(io, {
      noOpen: false,
      foreground: false,
      follow: false,
      deleteData: false,
      deleteWeights: false,
      deep: false,
    });
  }
  io.stdout("\nUpdate finished. Start again with: wavesmith start\n");
  return 0;
}

async function doctor(io: CliIo, flags: Flags): Promise<number> {
  const commands = {
    brew: io.command("brew"),
    node: io.command("node"),
    pnpm: io.command("pnpm"),
    uv: io.command("uv"),
    ffmpeg: io.command("ffmpeg"),
    python312: io.command("python3.12"),
    git: io.command("git"),
  };
  const input: DoctorInput = {
    commands,
    diskFreeBytes: io.diskFreeBytes(),
    weightsPresent: io.weightsPresent(),
    port3000: io.listenAddresses(3000),
    port8001: io.listenAddresses(8001),
    engineHealthy: await io.engineHealthy(),
    grok: await inspectGrokBuild({ deep: flags.deep, home: io.home, env: io.env }),
  };
  const checks = doctorChecks(input);
  io.stdout(formatDoctor(checks));
  if (doctorFailed(checks)) {
    io.stdout("Some checks failed. The fix is on the FAIL lines above.\n");
    return 1;
  }
  io.stdout("Everything this check looks at is in place.\n");
  return 0;
}

function logs(io: CliIo, follow: boolean): number {
  if (follow) {
    io.followLogs();
    return 0;
  }
  const text = io.logText();
  if (!text) {
    io.stdout("No log yet. Start Wavesmith, then run: wavesmith logs\n");
    return 0;
  }
  const recent = lastLines(text, 200);
  io.stdout(recent.endsWith("\n") || recent.length === 0 ? recent : `${recent}\n`);
  return 0;
}

function uninstall(io: CliIo, flags: Flags): number {
  if (checkoutBlocksUninstall(io.home, io.root)) {
    io.stderr("Refusing to uninstall. The Wavesmith folder is your home folder, or it contains your home.\n");
    return 1;
  }
  stop(io);
  const plistPath = `${io.home}/Library/LaunchAgents/com.wavesmith.login.plist`;
  if (io.platform === "darwin") {
    io.exec("launchctl", ["bootout", `gui/${io.uid}`, plistPath]);
  }
  let deleteData = flags.deleteData;
  let deleteWeights = flags.deleteWeights;
  if (!flags.deleteData && !flags.deleteWeights && io.isTty()) {
    deleteData = yes(io.prompt("Delete your songs in data/? [y/N] "));
    deleteWeights = yes(io.prompt("Delete the downloaded models (about 10 GB)? [y/N] "));
  } else if (!flags.deleteData && !flags.deleteWeights) {
    io.stdout("Keeping data/ and the downloaded models. Pass --delete-data or --delete-weights to remove them.\n");
  }
  const envText = io.readText(`${io.root}/.env`);
  const stateDir = io.env.WAVESMITH_STATE_DIR?.trim() || io.stateDir;
  const deleteEnv = deleteClassifyEnv({ root: io.root, stateDir, env: io.env, envText });
  const plan = planUninstall({
    root: io.root,
    home: io.home,
    stateDir,
    deleteData,
    deleteWeights,
    dataDir: deleteEnv.DATA_DIR ?? `${io.root}/data`,
    engineDir: deleteEnv.ENGINE_DIR ?? `${io.root}/engine/ACE-Step-1.5`,
    inspect: {
      realpath: (target) => fs.realpathSync(target),
      isSymlink: (target) => fs.lstatSync(target).isSymbolicLink(),
    },
  });
  let refused = 0;
  for (const note of plan.notes) io.stdout(`${note}\n`);
  const planned = [...plan.remove, ...plan.unlink.map((item) => item.link)];
  for (const target of planned) {
    const verdict = classifyDelete(target, { home: io.home, root: io.root, env: deleteEnv });
    if (!verdict.ok && !verdict.unlinkOnly) {
      io.stderr(`${verdict.message}\n`);
      refused += 1;
      continue;
    }
    io.remove(target);
  }
  for (const name of [".zprofile", ".bash_profile"]) {
    const file = `${io.home}/${name}`;
    const text = io.readText(file);
    if (!text || !text.includes("# Wavesmith")) continue;
    io.writeText(file, stripWavesmithPath(text));
  }
  if (refused > 0) {
    io.stderr("Uninstall did not delete those folders.\n");
    return 1;
  }
  io.stdout("Wavesmith is removed from the menu bar, the login item, and ~/.local/bin.\n");
  if (!deleteData && !deleteWeights) {
    io.stdout("The Wavesmith folder stays, so your songs, .env, and downloaded models stay.\n");
  } else {
    io.stdout("The Wavesmith folder stays. .env stays.\n");
  }
  io.stdout(`Kept: ${plan.keep.join(", ")}\n`);
  return 0;
}

function yes(answer: string): boolean {
  const value = answer.trim().toLowerCase();
  return value === "y" || value === "yes";
}

function login(io: CliIo, rest: readonly string[]): number {
  const action = rest[0] ?? "status";
  const plistPath = `${io.home}/Library/LaunchAgents/com.wavesmith.login.plist`;
  if (action === "status") {
    io.stdout(io.exists(plistPath) ? "on\n" : "off\n");
    return 0;
  }
  if (action !== "on" && action !== "off") {
    io.stderr("Use: wavesmith login on|off|status\n");
    return 1;
  }
  if (io.platform !== "darwin") {
    io.stderr("Launch at login is only available on macOS.\n");
    return 1;
  }
  if (action === "off") {
    io.exec("launchctl", ["bootout", `gui/${io.uid}`, plistPath]);
    io.remove(plistPath);
    io.stdout("Launch at login is off.\n");
    return 0;
  }
  const script = `${io.root}/scripts/wavesmith-login.sh`;
  const plist = renderLaunchAgent(script);
  if (plist.includes("XAI_API_KEY") || plist.includes("EnvironmentVariables")) {
    io.stderr("Refusing to write a login item that contains a secret.\n");
    return 1;
  }
  io.writeText(plistPath, plist);
  io.exec("launchctl", ["bootout", `gui/${io.uid}`, plistPath]);
  const boot = io.exec("launchctl", ["bootstrap", `gui/${io.uid}`, plistPath]);
  if (boot.code !== 0) {
    io.stderr("Couldn't register the login item.\nFix: run wavesmith login on again from Terminal.\n");
    return boot.code || 1;
  }
  io.stdout("Launch at login is on. Wavesmith starts now, and again each time you log in.\n");
  return 0;
}
