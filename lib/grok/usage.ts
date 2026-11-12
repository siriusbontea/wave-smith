/**
 * lib/grok/usage.ts — local totals for Grok subscription lyric calls.
 *
 * The CLI's token counts and total_cost_usd are stored under DATA_DIR.
 * Nothing here is sent to the network. Prompts are not stored.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

export interface GrokUsageEntry {
  at: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface GrokUsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

const sessionStartedAt = Date.now();
const MAX_ENTRIES = 400;

function usagePath(): string {
  return path.join(env.dataDir, "grok-subscription-usage.json");
}

function readEntries(): GrokUsageEntry[] {
  try {
    const body = JSON.parse(fs.readFileSync(usagePath(), "utf8")) as { entries?: unknown };
    if (!Array.isArray(body.entries)) return [];
    return body.entries.filter(isEntry);
  } catch {
    return [];
  }
}

function isEntry(value: unknown): value is GrokUsageEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.at === "number" && typeof row.model === "string" && typeof row.totalTokens === "number";
}

export function recordGrokUsage(entry: Omit<GrokUsageEntry, "at"> & { at?: number }): void {
  const entries = readEntries();
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
  const file = usagePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ entries: kept }), { mode: 0o600 });
}

function totals(entries: readonly GrokUsageEntry[]): GrokUsageTotals {
  return entries.reduce<GrokUsageTotals>(
    (sum, entry) => ({
      requests: sum.requests + 1,
      inputTokens: sum.inputTokens + (entry.inputTokens || 0),
      outputTokens: sum.outputTokens + (entry.outputTokens || 0),
      totalTokens: sum.totalTokens + (entry.totalTokens || 0),
      costUsd: sum.costUsd + (entry.costUsd || 0),
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
  );
}

export function summarizeGrokUsage(now = Date.now()): { session: GrokUsageTotals; today: GrokUsageTotals } {
  const entries = readEntries();
  const todayKey = new Date(now).toDateString();
  return {
    session: totals(entries.filter((entry) => entry.at >= sessionStartedAt)),
    today: totals(entries.filter((entry) => new Date(entry.at).toDateString() === todayKey)),
  };
}
