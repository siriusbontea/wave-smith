/**
 * lib/db/sqlite.ts — pragmas for every connection to the Wavesmith file.
 *
 * Next's build opens this file from several workers at once. Switching to WAL
 * takes a lock, and doing that with no busy timeout throws SQLITE_BUSY.
 * The timeout is set first. A connection that already sees WAL does not switch
 * again. An in-memory database cannot use WAL, so that mode is left alone.
 */
import type Database from "better-sqlite3";

const WAL_WAIT_MS = 5_000;

export function configureSqlite(sqlite: Database.Database): void {
  sqlite.pragma("busy_timeout = 5000");
  enableWal(sqlite);
  sqlite.pragma("foreign_keys = ON");
}

function enableWal(sqlite: Database.Database): void {
  const deadline = Date.now() + WAL_WAIT_MS;
  for (;;) {
    let mode: unknown;
    try {
      mode = sqlite.pragma("journal_mode", { simple: true });
    } catch (err) {
      if (!isSqliteBusy(err)) throw err;
      mode = null;
    }
    if (mode === "wal" || mode === "memory") return;
    try {
      const next = sqlite.pragma("journal_mode = WAL", { simple: true });
      if (next === "wal" || next === "memory") return;
    } catch (err) {
      if (!isSqliteBusy(err)) throw err;
    }
    if (Date.now() >= deadline) {
      throw new Error("SQLite stayed busy while switching to WAL");
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}

function isSqliteBusy(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code === "SQLITE_BUSY_TIMEOUT";
}
