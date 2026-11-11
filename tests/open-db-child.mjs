/**
 * Open one SQLite file the way a Next build worker does.
 * Spawned as its own process so several connections can hit WAL together.
 */
import Database from "better-sqlite3";
import { configureSqlite } from "../lib/db/sqlite.ts";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("missing db path");
  process.exit(1);
}

const sqlite = new Database(dbPath);
try {
  configureSqlite(sqlite);
  sqlite.exec("CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER)");
  sqlite.prepare("INSERT INTO probe (n) VALUES (?)").run(process.pid);
  const mode = sqlite.pragma("journal_mode", { simple: true });
  if (mode !== "wal") {
    console.error(`journal_mode=${String(mode)}`);
    process.exit(2);
  }
} finally {
  sqlite.close();
}
