/**
 * cli/supervise.ts — the background process wavesmith start leaves behind.
 * The app and the engine bind 127.0.0.1. A second start sees the pid file.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { childEnv } from "./envfile.ts";
import { portFrom, serializePid } from "./pid.ts";
import { repoRoot, stateDirectory } from "./paths.ts";

export async function supervise(options: { noOpen: boolean }): Promise<number> {
  const root = repoRoot(import.meta.url, process.env);
  const stateDir = stateDirectory({
    env: process.env,
    home: process.env.HOME || process.env.USERPROFILE || root,
    platform: process.platform,
  });
  fs.mkdirSync(stateDir, { recursive: true });
  const port = portFrom(process.env);
  const envFile = readEnv(root);
  const env = childEnv(envFile, process.env);
  env.PORT = String(port);
  env.HOSTNAME = "127.0.0.1";

  const children: ChildProcess[] = [];
  let shuttingDown = false;
  const pidFile = path.join(stateDir, "wavesmith.pid");

  const writePid = (enginePid: number | null, appPid: number | null) => {
    fs.writeFileSync(
      pidFile,
      serializePid({
        supervisorPid: process.pid,
        enginePid,
        appPid,
        port,
        startedAt: new Date().toISOString(),
      }),
    );
  };

  const shutdown = (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (!child.pid) continue;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        try {
          process.kill(child.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
    }
    try {
      fs.rmSync(pidFile, { force: true });
    } catch {
      // The stop command may have removed it.
    }
    process.exit(code);
  };

  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
  writePid(null, null);
  process.stdout.write(`Wavesmith app → http://127.0.0.1:${port}\n`);

  const engineDir = path.resolve(root, env.ENGINE_DIR || "engine/ACE-Step-1.5");
  const skipEngine =
    process.env.WAVESMITH_SKIP_ENGINE === "1" || env.MOCK_ENGINE === "1" || !fs.existsSync(path.join(engineDir, ".venv"));
  let enginePid: number | null = null;
  if (!skipEngine) {
    const engineEnv: Record<string, string> = { ...env };
    delete engineEnv.VIRTUAL_ENV;
    engineEnv.ACESTEP_LM_BACKEND = engineEnv.ACESTEP_LM_BACKEND || "mlx";
    engineEnv.ACESTEP_LM_MODEL_PATH =
      engineEnv.ENGINE_INIT_LM_MODEL || engineEnv.ACESTEP_LM_MODEL_PATH || "acestep-5Hz-lm-1.7B";
    engineEnv.TOKENIZERS_PARALLELISM = "false";
    const engine: ChildProcess = spawn("uv", ["run", "acestep-api", "--host", "127.0.0.1", "--port", "8001"], {
      cwd: engineDir,
      env: engineEnv as NodeJS.ProcessEnv,
      detached: true,
      stdio: "inherit",
    });
    children.push(engine);
    enginePid = engine.pid ?? null;
    process.stdout.write("Wavesmith engine → http://127.0.0.1:8001\n");
  }

  const app: ChildProcess = spawn(
    "pnpm",
    ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      env: env as NodeJS.ProcessEnv,
      detached: true,
      stdio: "inherit",
    },
  );
  children.push(app);
  writePid(enginePid, app.pid ?? null);
  app.on("exit", () => {
    if (!shuttingDown) shutdown(1);
  });

  const ready = await waitFor(`http://127.0.0.1:${port}/api/health`, 120_000);
  const open = !options.noOpen && process.env.WAVESMITH_NO_OPEN !== "1";
  if (ready && open) openBrowser(`http://127.0.0.1:${port}`);
  if (!ready) process.stdout.write("Wavesmith has not answered /api/health yet. It is still starting.\n");
  await new Promise(() => {
    // Stay up until stop sends SIGTERM.
  });
  return 0;
}

function readEnv(root: string): string | null {
  const file = path.join(root, ".env");
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

async function waitFor(url: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore" });
  child.on("error", () => {
    // No desktop session. The URL is already on stdout.
  });
  child.unref();
}
