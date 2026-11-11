/**
 * Several processes open one SQLite file at the same time.
 * `next build` does this from parallel workers. The WAL switch has to wait
 * instead of throwing SQLITE_BUSY.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { configureSqlite } from "@/lib/db/sqlite";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-db-"));
  dirs.push(dir);
  return path.join(dir, "wavesmith.db");
}

function openChild(dbPath: string): Promise<{ code: number; stderr: string }> {
    const script = path.resolve("tests/open-db-child.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", script, dbPath], {
      cwd: path.resolve("."),
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

describe("sqlite open", () => {
  it("sets a busy timeout before WAL", () => {
    const sqlite = new Database(tempDb());
    configureSqlite(sqlite);
    expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    sqlite.close();
  });

  it("leaves an in-memory database alone", () => {
    const sqlite = new Database(":memory:");
    configureSqlite(sqlite);
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("memory");
    sqlite.close();
  });

  it("opens the same file from several connections", async () => {
    const dbPath = tempDb();
    const opened = await Promise.all(Array.from({ length: 6 }, () => openChild(dbPath)));
    for (const result of opened) {
      expect(result.stderr).not.toMatch(/SQLITE|Error/);
      expect(result.code).toBe(0);
    }
    const sqlite = new Database(dbPath);
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    const count = sqlite.prepare("SELECT COUNT(*) AS n FROM probe").get() as { n: number };
    expect(count.n).toBe(6);
    sqlite.close();
  });

  it("waits when another connection holds the file", async () => {
    const dbPath = tempDb();
    const holder = new Database(dbPath);
    holder.exec("CREATE TABLE hold (id INTEGER)");
    holder.exec("BEGIN IMMEDIATE");
    const pending = openChild(dbPath);
    await new Promise((resolve) => setTimeout(resolve, 150));
    holder.exec("COMMIT");
    const result = await pending;
    holder.close();
    expect(result.stderr).not.toMatch(/SQLITE|Error/);
    expect(result.code).toBe(0);
    const sqlite = new Database(dbPath);
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    sqlite.close();
  });
});
