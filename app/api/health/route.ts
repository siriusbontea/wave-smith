/**
 * GET /api/health — the app's readiness endpoint.
 *
 * Drives the persistent status banner (spec §9.1) and is the readiness probe
 * for the future Tauri wrap (spec §14). Reports the app itself, the SQLite
 * database, and the engine's three-state health. Never throws: a broken
 * engine or db is a reported state, not a 500.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { probeEngine } from "@/lib/engine/status";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic"; // health must never be statically cached

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

  // Demo/test mode never probes the real engine — the mock is always "ready"
  // (the full EngineClient seam routes this properly in M2).
  const engine = env.MOCK_ENGINE
    ? {
        state: "ready" as const,
        modelsInitialized: true,
        llmInitialized: true,
        loadedModel: "mock",
        loadedLmModel: "mock",
      }
    : await probeEngine();

  return NextResponse.json({
    app: "ok",
    version: "0.1.0",
    db: dbOk ? "ok" : "error",
    mockEngine: env.MOCK_ENGINE,
    engine,
    timestamp: Date.now(),
  });
}
