/**
 * lib/setup/progress.ts — what the setup screen shows.
 * Pure data. The file on disk is written by scripts/setup.sh.
 */

import { z } from "zod";

export interface SetupView {
  running: boolean;
  phase: string;
  percent: number | null;
  etaSeconds: number | null;
  message: string;
}

const idle: SetupView = {
  running: false,
  phase: "idle",
  percent: null,
  etaSeconds: null,
  message: "",
};

const SetupFile = z.object({
  running: z.boolean(),
  phase: z.string().default("setup"),
  percent: z.number().min(0).max(100).nullable().optional(),
  etaSeconds: z.number().nullable().optional(),
  message: z.string().default("Setting up Wavesmith"),
});

export function interpretSetup(raw: string | null): SetupView {
  if (!raw) return idle;
  try {
    const parsed = SetupFile.safeParse(JSON.parse(raw));
    if (!parsed.success) return idle;
    const eta = parsed.data.etaSeconds;
    return {
      running: parsed.data.running,
      phase: parsed.data.phase,
      percent: parsed.data.percent ?? null,
      etaSeconds: eta != null && eta >= 0 && Number.isFinite(eta) ? Math.round(eta) : null,
      message: parsed.data.message,
    };
  } catch {
    return idle;
  }
}

export function formatEta(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 45) return "Less than a minute left";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 90) return `About ${minutes} minutes left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `About ${hours} hours left`;
  return `About ${hours} hours ${rest} minutes left`;
}
