/**
 * lib/db/index.ts — the app's single SQLite connection (better-sqlite3 + Drizzle).
 *
 * Flow: first import opens the database under DATA_DIR, enables WAL for
 * concurrent reads during generation writes, applies pending migrations
 * (idempotent), and caches the client on globalThis — the same trick the queue
 * worker uses (spec §8) so Next.js dev-mode HMR never opens duplicate handles.
 */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { configureSqlite } from "@/lib/db/sqlite";
import * as schema from "@/db/schema";

type DB = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as unknown as { __wavesmithDb?: DB };

function createDb(): DB {
  // Paths resolve against process.cwd(): this module must only be imported
  // from request-time server code with the app started from the project root
  // (all scripts/* do). Fail loudly if that invariant is broken rather than
  // silently creating a database somewhere surprising.
  const migrationsFolder = path.resolve("db/migrations");
  if (!fs.existsSync(migrationsFolder)) {
    throw new Error(
      `db/migrations not found at ${migrationsFolder} — start Wavesmith from ` +
        `the project root (or set DATA_DIR to an absolute path).`,
    );
  }
  fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
  const sqlite = new Database(env.dbPath);
  // WAL lets the queue worker write while a request reads. busy_timeout is set
  // inside configureSqlite, before the mode switch, so parallel build workers
  // wait instead of throwing SQLITE_BUSY.
  configureSqlite(sqlite);
  const database = drizzle(sqlite, { schema });
  // Next's build collects pages in several workers. They must not apply one
  // migration at the same time.
  withMigrateLock(env.dbPath, () => {
    migrate(database, { migrationsFolder });
  });
  return database;
}

function withMigrateLock(dbPath: string, run: () => void): void {
  const lockPath = `${dbPath}.migrate.lock`;
  const started = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        run();
      } finally {
        fs.closeSync(fd);
        fs.rmSync(lockPath, { force: true });
      }
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 30_000) fs.rmSync(lockPath, { force: true });
      } catch {
        // The other worker removed it.
      }
      if (Date.now() - started > 30_000) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

export const db: DB = globalForDb.__wavesmithDb ?? createDb();
globalForDb.__wavesmithDb = db;

export { schema };
