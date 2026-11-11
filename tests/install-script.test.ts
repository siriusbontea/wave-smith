/**
 * The installer must do nothing until the whole file is present, and a
 * stopped setup file must stay readable after the installer exits.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function bash(script: string, home: string) {
  return spawnSync("bash", ["-s"], {
    input: script,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

describe("install.sh", () => {
  const source = fs.readFileSync(path.join(root, "scripts/install.sh"), "utf8");

  it("calls main only on the last line", () => {
    const lines = source.trimEnd().split("\n");
    expect(lines[lines.length - 1]).toBe('main "$@"');
    expect(source).not.toMatch(/brew link --overwrite --force/);
    expect(source).toMatch(/--proto '=https' --tlsv1\.2/);
    expect(source).toMatch(/7986efac25016e41eed7e471666140c06f9d97cf/);
    expect(source).not.toMatch(/Homebrew\/install\/HEAD/);
    expect(source).toMatch(/df -k/);
  });

  it("a truncated installer does nothing", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ws home "));
    const lines = source.trimEnd().split("\n");
    const withoutCall = `${lines.slice(0, -1).join("\n")}\n`;
    const dropped = bash(withoutCall, home);
    expect(dropped.status).toBe(0);
    expect(fs.existsSync(path.join(home, "Wavesmith"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".zprofile"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".bash_profile"))).toBe(false);

    const mid = bash(lines.slice(0, 40).join("\n"), home);
    expect(mid.status).not.toBe(0);
    expect(fs.existsSync(path.join(home, "Wavesmith"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".zprofile"))).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe("setup state", () => {
  it("records a stopped setup and leaves a failed one alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-setup-state-"));
    const file = path.join(dir, "setup-progress.json");
    const script = path.join(root, "scripts/mark-setup-stopped.sh");
    fs.writeFileSync(file, JSON.stringify({ running: true, phase: "setup", message: "Installing" }));
    const stopped = spawnSync("bash", [script, file], { encoding: "utf8" });
    expect(stopped.status).toBe(0);
    const body = JSON.parse(fs.readFileSync(file, "utf8")) as { running: boolean; phase: string; message: string };
    expect(body.running).toBe(false);
    expect(body.phase).toBe("stopped");
    expect(body.message).toMatch(/stopped before it finished/);

    fs.writeFileSync(file, JSON.stringify({ running: false, phase: "failed", message: "Setup stopped before it finished." }));
    expect(spawnSync("bash", [script, file], { encoding: "utf8" }).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).phase).toBe("failed");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not kill an unrelated setup-ui pid, and does not treat it as running", () => {
    const child = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
    const pid = child.pid as number;
    const started = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
    const command = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-setup-ui-"));
    fs.writeFileSync(path.join(dir, "setup-ui.pid"), `${pid}\n${started}\n${command}\n`);
    const stop = spawnSync("bash", [path.join(root, "scripts/setup-ui.sh"), "stop"], {
      encoding: "utf8",
      env: { ...process.env, WAVESMITH_STATE_DIR: dir, HOME: dir },
    });
    expect(stop.status).toBe(0);
    expect(() => process.kill(pid, 0)).not.toThrow();

    fs.writeFileSync(path.join(dir, "setup-ui.pid"), `${pid}\nWed Jan 1 00:00:00 1970\npnpm dev --hostname 127.0.0.1\n`);
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    const marker = path.join(dir, "pnpm-pids");
    fs.writeFileSync(path.join(bin, "pnpm"), `#!/bin/sh\necho $$ >> ${JSON.stringify(marker)}\nsleep 60\n`);
    fs.chmodSync(path.join(bin, "pnpm"), 0o755);
    const start = spawnSync("bash", [path.join(root, "scripts/setup-ui.sh"), "start"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, WAVESMITH_STATE_DIR: dir, HOME: dir },
    });
    expect(start.status).toBe(0);
    expect(start.stdout).not.toMatch(/already running/);
    expect(start.stdout).toMatch(/Setup screen starting/);
    const launched = fs.readFileSync(marker, "utf8").trim().split("\n").filter(Boolean);
    expect(launched).toHaveLength(1);
    const again = spawnSync("bash", [path.join(root, "scripts/setup-ui.sh"), "start"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, WAVESMITH_STATE_DIR: dir, HOME: dir },
    });
    expect(again.stdout).toMatch(/already running/);
    expect(fs.readFileSync(marker, "utf8").trim().split("\n").filter(Boolean)).toHaveLength(1);
    spawnSync("bash", [path.join(root, "scripts/setup-ui.sh"), "stop"], {
      encoding: "utf8",
      env: { ...process.env, WAVESMITH_STATE_DIR: dir, HOME: dir },
    });
    expect(() => process.kill(pid, 0)).not.toThrow();
    process.kill(pid, "SIGKILL");
    child.unref();
    for (const launchedPid of launched) {
      try {
        process.kill(Number(launchedPid), "SIGKILL");
      } catch {
        // The stop already ended it.
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
