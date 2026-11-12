/**
 * Grok Build subscription: a fake grok binary, never a shell, never auth.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as lyricsPOST } from "@/app/api/lyrics/route";
import { doctorChecks } from "@/cli/doctor.ts";
import {
  GrokBuildError,
  buildGrokArgv,
  inspectGrokBuild,
  resolveGrokBinary,
  runGrokBuild,
} from "@/cli/grok-build.ts";
import { parseArgs } from "@/cli/args.ts";
import { getConnectionMode, setConnectionMode, setLyricsPolicy, grokAllowed, subscriptionAllowed } from "@/lib/grok/mode";
import { friendlySubscriptionError } from "@/lib/grok/subscription";
import { summarizeGrokUsage } from "@/lib/grok/usage";

const fixture = path.resolve("tests/fixtures/fake-grok.mjs");
const modeFile = path.resolve("tests/fixtures/mode.txt");
const callsLog = path.resolve("tests/fixtures/calls.log");

const saved = {
  GROK_BIN: process.env.GROK_BIN,
  XAI_API_KEY: process.env.XAI_API_KEY,
  HOME: process.env.HOME,
  WAVESMITH_CONNECTION_MODE: process.env.WAVESMITH_CONNECTION_MODE,
  GROK_BUILD_CONCURRENCY: process.env.GROK_BUILD_CONCURRENCY,
};

function restore(name: keyof typeof saved): void {
  const value = saved[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function setMode(mode: string): void {
  fs.writeFileSync(modeFile, mode);
}

afterEach(() => {
  restore("GROK_BIN");
  restore("XAI_API_KEY");
  restore("HOME");
  restore("WAVESMITH_CONNECTION_MODE");
  restore("GROK_BUILD_CONCURRENCY");
  fs.rmSync(modeFile, { force: true });
  fs.rmSync(callsLog, { force: true });
  setConnectionMode("local");
  setLyricsPolicy("standard");
});

function safetyArgs(argv: readonly string[]): void {
  expect(argv).toContain("--no-auto-update");
  expect(argv).toContain("--output-format");
  expect(argv).toContain("json");
  expect(argv).toContain("--max-turns");
  expect(argv).toContain("1");
  expect(argv).toContain("--no-subagents");
  expect(argv).toContain("--disable-web-search");
  expect(argv).toContain("--no-plan");
  expect(argv).toContain("--verbatim");
  expect(argv).toContain("--prompt-file");
  const tools = argv.indexOf("--tools");
  expect(tools).toBeGreaterThanOrEqual(0);
  expect(argv[tools + 1]).toBe("");
  expect(argv.join("\n")).not.toMatch(/--yolo|--always-approve|bypassPermissions/);
}

describe("Grok Build CLI", () => {
  it("builds an argv that cannot approve tools", () => {
    const argv = buildGrokArgv({
      promptFile: "/tmp/prompt.txt",
      cwd: "/tmp/scratch",
      systemPrompt: "system",
      model: "grok-4.7",
    });
    safetyArgs(argv);
    expect(argv).toContain("-m");
    expect(argv).toContain("grok-4.7");
    expect(path.isAbsolute(argv[argv.indexOf("--prompt-file") + 1] ?? "")).toBe(true);
  });

  it("runs the fake binary with safety flags, a temp dir, and no secret env", async () => {
    setMode("success");
    process.env.XAI_API_KEY = "super-secret-key";
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-grok-home-"));
    fs.mkdirSync(path.join(home, ".grok"), { recursive: true });
    fs.writeFileSync(path.join(home, ".grok", "auth.json"), "do-not-read-this-token\n");
    const readFileSync = vi.spyOn(fs, "readFileSync");
    const readFile = vi.spyOn(fs, "readFile");
    const readFilePromise = vi.spyOn(fs.promises, "readFile");
    let scratch = "";
    try {
      const output = await runGrokBuild({
        prompt: "UNIQUE-PROMPT-NEEDLE about rain",
        systemPrompt: "SYSTEM-NEEDLE",
        model: "grok-4.7",
        home,
        configuredPath: fixture,
        hooks: {
          afterRun(dir) {
            scratch = dir;
            const stat = fs.statSync(dir);
            expect(stat.mode & 0o777).toBe(0o700);
            const promptStat = fs.statSync(path.join(dir, "prompt.txt"));
            expect(promptStat.mode & 0o777).toBe(0o600);
            const record = JSON.parse(fs.readFileSync(path.join(dir, "argv.json"), "utf8")) as {
              argv: string[];
              env: Record<string, string>;
              parent: string;
              cwd: string;
            };
            safetyArgs(record.argv);
            expect(record.argv).toContain("SYSTEM-NEEDLE");
            expect(record.argv.join("\n")).not.toContain("UNIQUE-PROMPT-NEEDLE");
            expect(fs.readFileSync(path.join(dir, "prompt.txt"), "utf8")).toContain("UNIQUE-PROMPT-NEEDLE");
            expect(record.cwd).toBe(dir);
            expect(record.argv[record.argv.indexOf("--cwd") + 1]).toBe(dir);
            expect(record.env.XAI_API_KEY).toBeUndefined();
            expect(record.env.HOME).toBe(home);
            expect(record.env.LANG).toBeTruthy();
            expect(Object.keys(record.env).filter((key) => !["PATH", "HOME", "LANG"].includes(key))).toEqual([]);
            expect(record.parent).toMatch(/node/);
            expect(record.parent).not.toMatch(/\b(sh|bash|zsh)\b/);
            expect(fs.readdirSync(dir).some((name) => name.includes("auth"))).toBe(false);
          },
        },
      });
      expect(output.text).toContain("[verse]");
      expect(output.stopReason).toBe("end_turn");
      expect(output.inputTokens).toBe(14000);
      expect(output.costUsd).toBe(0.0275);
      expect(output.model).toBe("grok-4.7");
      expect(scratch.length).toBeGreaterThan(0);
      expect(fs.existsSync(scratch)).toBe(false);
      const touched = [
        ...readFileSync.mock.calls.map((call) => String(call[0])),
        ...readFile.mock.calls.map((call) => String(call[0])),
        ...readFilePromise.mock.calls.map((call) => String(call[0])),
      ];
      expect(touched.some((file) => file.includes("auth.json"))).toBe(false);
    } finally {
      readFileSync.mockRestore();
      readFile.mockRestore();
      readFilePromise.mockRestore();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("finds an executable under ~/.grok/bin and ignores a bad version", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-grok-home-"));
    const binDir = path.join(home, ".grok", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(home, ".grok", "auth.json"), "token\n");
    const link = path.join(binDir, "grok");
    fs.symlinkSync(fixture, link);
    fs.chmodSync(fixture, 0o755);
    const decoy = path.join(os.tmpdir(), `wavesmith-not-grok-${process.pid}`);
    fs.writeFileSync(decoy, "#!/bin/sh\necho nope\n", { mode: 0o755 });
    const readFileSync = vi.spyOn(fs, "readFileSync");
    try {
      const found = resolveGrokBinary({ home, configuredPath: decoy });
      expect(found.found).toBe(true);
      expect(found.path).toBe(link);
      expect(found.version).toMatch(/^grok \d/);
      expect(readFileSync.mock.calls.map((call) => String(call[0])).some((file) => file.includes("auth.json"))).toBe(
        false,
      );
    } finally {
      readFileSync.mockRestore();
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(decoy, { force: true });
    }
  });

  it("reports each CLI failure and still deletes the temp dir", async () => {
    const cases: Array<{ mode: string; kind: GrokBuildError["kind"] }> = [
      { mode: "unauthenticated", kind: "unauthenticated" },
      { mode: "malformed", kind: "protocol" },
      { mode: "nonzero", kind: "exit" },
      { mode: "huge", kind: "output" },
      { mode: "empty", kind: "protocol" },
      { mode: "stopped", kind: "protocol" },
      { mode: "hang", kind: "timeout" },
    ];
    for (const item of cases) {
      setMode(item.mode);
      let scratch = "";
      const err = await runGrokBuild({
        prompt: "prompt",
        systemPrompt: "system",
        home: os.homedir(),
        configuredPath: fixture,
        timeoutMs: item.mode === "hang" ? 400 : 10_000,
        hooks: {
          afterRun(dir) {
            scratch = dir;
          },
        },
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(err, item.mode).toBeInstanceOf(GrokBuildError);
      expect((err as GrokBuildError).kind, item.mode).toBe(item.kind);
      if (item.kind === "unauthenticated") {
        expect((err as Error).message).toMatch(/grok login/);
        expect((err as Error).message).not.toMatch(/API key|XAI_API_KEY/);
      }
      expect(fs.existsSync(scratch), item.mode).toBe(false);
    }
  });

  it("runs one subscription call at a time", async () => {
    setMode("slow");
    const started = Date.now();
    await Promise.all([
      runGrokBuild({
        prompt: "one",
        systemPrompt: "system",
        home: os.homedir(),
        configuredPath: fixture,
        timeoutMs: 10_000,
      }),
      runGrokBuild({
        prompt: "two",
        systemPrompt: "system",
        home: os.homedir(),
        configuredPath: fixture,
        timeoutMs: 10_000,
      }),
    ]);
    const stamps = fs
      .readFileSync(callsLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => Number(line));
    expect(stamps).toHaveLength(2);
    expect((stamps[1] ?? 0) - (stamps[0] ?? 0)).toBeGreaterThanOrEqual(150);
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
  });

  it("doctor checks the binary without a sign-in probe unless --deep", async () => {
    const deep = parseArgs(["doctor", "--deep"]);
    expect(deep.ok).toBe(true);
    if (deep.ok) expect(deep.flags.deep).toBe(true);
    expect(parseArgs(["start", "--deep"]).ok).toBe(false);

    setMode("unauthenticated");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-grok-home-"));
    try {
      const skipped = await inspectGrokBuild({ deep: false, home, configuredPath: fixture });
      expect(skipped.auth).toBe("skipped");
      expect(skipped.version).toMatch(/^grok \d/);
      const checked = doctorChecks({
        commands: {
          brew: { ok: true, version: "Homebrew" },
          node: { ok: true, version: "v22.14.0" },
          pnpm: { ok: true, version: "pnpm" },
          uv: { ok: true, version: "uv" },
          ffmpeg: { ok: true, version: "ffmpeg" },
          python312: { ok: true, version: "Python 3.12" },
          git: { ok: true, version: "git" },
        },
        diskFreeBytes: 40 * 1024 * 1024 * 1024,
        weightsPresent: true,
        port3000: ["127.0.0.1"],
        port8001: [],
        engineHealthy: false,
        grok: skipped,
      });
      expect(checked.find((row) => row.name === "Grok Build")?.ok).toBe(true);

      const probed = await inspectGrokBuild({ deep: true, home, configuredPath: fixture });
      expect(probed.auth).toBe("unauthenticated");
      const failed = doctorChecks({
        commands: {
          brew: { ok: true, version: "Homebrew" },
          node: { ok: true, version: "v22.14.0" },
          pnpm: { ok: true, version: "pnpm" },
          uv: { ok: true, version: "uv" },
          ffmpeg: { ok: true, version: "ffmpeg" },
          python312: { ok: true, version: "Python 3.12" },
          git: { ok: true, version: "git" },
        },
        diskFreeBytes: 40 * 1024 * 1024 * 1024,
        weightsPresent: true,
        port3000: ["127.0.0.1"],
        port8001: [],
        engineHealthy: false,
        grok: probed,
      });
      const row = failed.find((item) => item.name === "Grok Build");
      expect(row?.ok).toBe(false);
      expect(row?.fix).toMatch(/grok login/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("subscription lyrics route", () => {
  it("uses the CLI when selected, and does not use it for the API-key mode", async () => {
    setMode("success");
    process.env.GROK_BIN = fixture;
    setConnectionMode("grok-subscription");
    expect(subscriptionAllowed()).toBe(true);
    expect(grokAllowed()).toBe(false);
    const res = await lyricsPOST(
      new Request("http://127.0.0.1:3000/api/lyrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "a song about rain" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; lyrics: string; notice: string | null };
    expect(body.source).toBe("grok-subscription");
    expect(body.lyrics).toContain("[verse]");
    expect(body.notice).toBeNull();
    expect(summarizeGrokUsage().today.requests).toBe(1);
    expect(summarizeGrokUsage().today.costUsd).toBeCloseTo(0.0275);

    const callsAfter = fs.readFileSync(callsLog, "utf8").trim().split("\n").length;
    setConnectionMode("grok");
    const hybrid = await lyricsPOST(
      new Request("http://127.0.0.1:3000/api/lyrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "a song about rain" }),
      }),
    );
    const hybridBody = (await hybrid.json()) as { source: string; notice: string | null };
    expect(hybridBody.source).toBe("local");
    expect(hybridBody.notice).toMatch(/API key/);
    expect(fs.readFileSync(callsLog, "utf8").trim().split("\n")).toHaveLength(callsAfter);

    setMode("unauthenticated");
    setConnectionMode("grok-subscription");
    const fallback = await lyricsPOST(
      new Request("http://127.0.0.1:3000/api/lyrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "a song about rain" }),
      }),
    );
    const fallbackBody = (await fallback.json()) as { source: string; notice: string | null };
    expect(fallbackBody.source).toBe("local");
    expect(fallbackBody.notice).toMatch(/grok login/);
    expect(fallbackBody.notice).toMatch(/local writer/);
    expect(fallbackBody.notice).not.toMatch(/API key/);

    setLyricsPolicy("unrestricted");
    const before = fs.readFileSync(callsLog, "utf8").length;
    const skipped = await lyricsPOST(
      new Request("http://127.0.0.1:3000/api/lyrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "a song about rain" }),
      }),
    );
    const skippedBody = (await skipped.json()) as { source: string; notice: string | null };
    expect(skippedBody.source).toBe("local");
    expect(skippedBody.notice).toMatch(/not used/);
    expect(fs.readFileSync(callsLog, "utf8").length).toBe(before);

    process.env.WAVESMITH_CONNECTION_MODE = "grok-subscription";
    setConnectionMode("local");
    expect(getConnectionMode()).toBe("grok-subscription");
    delete process.env.WAVESMITH_CONNECTION_MODE;
    expect(getConnectionMode()).toBe("local");
    expect(friendlySubscriptionError(new GrokBuildError("unauthenticated", "nope"), true)).not.toMatch(/API key/);
  });
});
