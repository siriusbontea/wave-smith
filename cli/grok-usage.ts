/**
 * cli/grok-usage.ts — local token totals for Grok subscription calls.
 *
 * Writers take a SQLite transaction, then replace the JSON file in the same
 * directory. Two lyric calls (or a lyric call and doctor --deep) cannot drop
 * each other's row. Prompts are not stored. The file mode is 0600.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export interface GrokUsageEntry {
  at: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
}

const MAX_ENTRIES = 400;

function usageFile(dataDir: string): string {
  return path.join(dataDir, "grok-subscription-usage.json");
}

function isEntry(value: unknown): value is GrokUsageEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.at === "number" && typeof row.model === "string" && typeof row.totalTokens === "number";
}

export function readGrokUsageEntries(dataDir: string): GrokUsageEntry[] {
  try {
    const body = JSON.parse(fs.readFileSync(usageFile(dataDir), "utf8")) as { entries?: unknown };
    if (!Array.isArray(body.entries)) return [];
    return body.entries.filter(isEntry);
  } catch {
    return [];
  }
}

function withUsageTransaction(dataDir: string, fn: () => void): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const lockPath = path.join(dataDir, "grok-subscription-usage.lock.sqlite");
  const db = new Database(lockPath);
  try {
    fs.chmodSync(lockPath, 0o600);
    db.pragma("busy_timeout = 5000");
    db.exec("CREATE TABLE IF NOT EXISTS lock (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL)");
    db.prepare("INSERT OR IGNORE INTO lock (id, n) VALUES (1, 0)").run();
    const tx = db.transaction(() => {
      db.prepare("UPDATE lock SET n = n + 1 WHERE id = 1").run();
      fn();
    });
    tx.immediate();
  } finally {
    db.close();
  }
}

export function recordGrokUsageFile(
  dataDir: string,
  entry: Omit<GrokUsageEntry, "at"> & { at?: number },
): void {
  withUsageTransaction(dataDir, () => {
    const entries = readGrokUsageEntries(dataDir);
    entries.push({
      at: entry.at ?? Date.now(),
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      reasoningTokens: entry.reasoningTokens,
      totalTokens: entry.totalTokens,
      costUsd: entry.costUsd,
    });
    const kept = entries.slice(-MAX_ENTRIES);
    const file = usageFile(dataDir);
    const tmp = path.join(
      dataDir,
      `.grok-usage-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
    );
    let renamed = false;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ entries: kept }), { mode: 0o600 });
      fs.renameSync(tmp, file);
      renamed = true;
      fs.chmodSync(file, 0o600);
    } finally {
      if (!renamed) fs.rmSync(tmp, { force: true });
    }
  });
}
