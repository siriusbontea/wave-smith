/**
 * lib/grok/mode.ts — Local only vs Grok hybrid, and unrestricted lyrics.
 *
 * Local only is the default and never calls xAI. Grok hybrid uses an API key.
 * Grok subscription uses the local Grok Build CLI and does not use that key.
 * Unrestricted lyrics keep both off: a hosted model may refuse, and this app
 * does not add its own filter on the local writer.
 */
import { getSetting, setSetting } from "@/lib/settings/queries";

export type ConnectionMode = "local" | "grok" | "grok-subscription";
export type LyricsPolicy = "standard" | "unrestricted";

export function getConnectionMode(): ConnectionMode {
  const fromEnv = process.env.WAVESMITH_CONNECTION_MODE?.trim();
  if (fromEnv === "local" || fromEnv === "grok" || fromEnv === "grok-subscription") return fromEnv;
  const stored = getSetting("connection_mode");
  if (stored === "grok" || stored === "grok-subscription") return stored;
  return "local";
}

export function getLyricsPolicy(): LyricsPolicy {
  return getSetting("lyrics_policy") === "unrestricted" ? "unrestricted" : "standard";
}

export function setConnectionMode(mode: ConnectionMode): void {
  setSetting("connection_mode", mode);
}

export function setLyricsPolicy(policy: LyricsPolicy): void {
  setSetting("lyrics_policy", policy);
}

/** API-key hybrid is selected AND unrestricted is off — the only case that may call xAI with a key. */
export function grokAllowed(): boolean {
  return getConnectionMode() === "grok" && getLyricsPolicy() !== "unrestricted";
}

/** Grok Build CLI is selected AND unrestricted is off. This does not use the API key. */
export function subscriptionAllowed(): boolean {
  return getConnectionMode() === "grok-subscription" && getLyricsPolicy() !== "unrestricted";
}
