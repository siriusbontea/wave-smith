/**
 * lib/grok/usage.ts — Settings totals for Grok subscription calls.
 *
 * Rows live in DATA_DIR and include lyric calls plus a successful
 * `wavesmith doctor --deep` probe. Nothing here is sent to the network.
 */
import { readGrokUsageEntries, recordGrokUsageFile, type GrokUsageEntry } from "@/cli/grok-usage.ts";
import { env } from "@/lib/env";

export type { GrokUsageEntry };

export interface GrokUsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

const sessionStartedAt = Date.now();

export function recordGrokUsage(entry: Omit<GrokUsageEntry, "at"> & { at?: number }): void {
  recordGrokUsageFile(env.dataDir, entry);
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
  const entries = readGrokUsageEntries(env.dataDir);
  const todayKey = new Date(now).toDateString();
  return {
    session: totals(entries.filter((entry) => entry.at >= sessionStartedAt)),
    today: totals(entries.filter((entry) => new Date(entry.at).toDateString() === todayKey)),
  };
}
