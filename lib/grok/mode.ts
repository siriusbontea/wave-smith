/**
 * lib/grok/mode.ts — Local only vs Grok hybrid, and unrestricted lyrics.
 *
 * Local only is the default and never calls xAI. Unrestricted lyrics also
 * keep Grok out of the path: a hosted model may refuse, and this app does
 * not add its own filter on the local writer.
 */
import { getSetting, setSetting } from "@/lib/settings/queries";

export type ConnectionMode = "local" | "grok";
export type LyricsPolicy = "standard" | "unrestricted";

export function getConnectionMode(): ConnectionMode {
  return getSetting("connection_mode") === "grok" ? "grok" : "local";
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

/** Hybrid is selected AND unrestricted is off — the only case that may call xAI. */
export function grokAllowed(): boolean {
  return getConnectionMode() === "grok" && getLyricsPolicy() !== "unrestricted";
}
