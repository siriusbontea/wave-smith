/**
 * GET /api/health — the app's readiness endpoint.
 *
 * Drives the persistent status banner (spec §9.1) and is the readiness probe
 * for the future Tauri wrap (spec §14). Reports the app itself, the SQLite
 * database, the engine's three-state health (via the EngineClient seam — the
 * mock reports ready without network), and lyrics-LLM availability. Never
 * throws: a broken engine or db is a reported state, not a 500.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getEngineClient } from "@/lib/engine";
import { readGrokApiKey } from "@/lib/grok/secrets";
import { getLyricsClient } from "@/lib/lyrics";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic"; // health must never be statically cached

/** Lyrics availability probed at most every 30 s — keep /api/health snappy
 *  under the UI's 1 s job polling without hammering Ollama. */
let lyricsCache: { available: boolean; at: number } | null = null;

export async function GET() {
  let dbOk = false;
  try {
    // Importing lib/db opens the connection and applies migrations (idempotent).
    const { db } = await import("@/lib/db");
    db.run(sql`SELECT 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const engine = await getEngineClient()
    .health()
    .catch(() => ({
      state: "offline" as const,
      modelsInitialized: false,
      llmInitialized: false,
      loadedModel: null,
      loadedLmModel: null,
    }));

  if (!lyricsCache || Date.now() - lyricsCache.at > 30_000) {
    const available = await getLyricsClient()
      .available()
      .catch(() => false);
    lyricsCache = { available, at: Date.now() };
  }

  const grokKey = readGrokApiKey();
  let mode: "local" | "grok" = "local";
  let lyricsPolicy: "standard" | "unrestricted" = "standard";
  if (dbOk) {
    try {
      const prefs = await import("@/lib/grok/mode");
      mode = prefs.getConnectionMode();
      lyricsPolicy = prefs.getLyricsPolicy();
    } catch {
      // A broken settings table must not take down the readiness probe.
    }
  }

  return NextResponse.json({
    app: "ok",
    version: "0.1.0",
    db: dbOk ? "ok" : "error",
    mockEngine: env.MOCK_ENGINE,
    engine,
    lyrics: { available: lyricsCache.available, model: env.LYRICS_MODEL },
    connection: {
      mode,
      lyricsPolicy,
      grokConfigured: grokKey.key != null,
      grokKeySource: grokKey.source,
    },
    timestamp: Date.now(),
  });
}
