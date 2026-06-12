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
  sqlite.pragma("journal_mode = WAL"); // readers don't block the queue worker's writes
  sqlite.pragma("foreign_keys = ON"); // stems.song_id cascade relies on this
  const database = drizzle(sqlite, { schema });
  // Idempotent: applies only migrations not yet recorded in __drizzle_migrations.
  migrate(database, { migrationsFolder });
  return database;
}

export const db: DB = globalForDb.__wavesmithDb ?? createDb();
globalForDb.__wavesmithDb = db;

export { schema };
