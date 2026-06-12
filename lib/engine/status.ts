/**
 * lib/engine/status.ts — engine health probe used by /api/health.
 *
 * Maps the engine's GET /health response onto the three first-run honesty
 * states the UI banner needs (spec §9.1):
 *   offline  — engine process unreachable (connection refused / timeout)
 *   starting — HTTP up but DiT weights not loaded yet (models_initialized=false)
 *   ready    — models_initialized=true (DiT can generate)
 *
 * M0-verified semantics (ENGINE_NOTES §2): readiness keys ONLY on
 * `models_initialized` — `loaded_model` echoes the configured name even before
 * any weights load, and `status` is always "ok". `llm_initialized` is reported
 * separately so LM-dependent features (Enhance, Simple mode) can degrade
 * independently. The probe uses a short timeout because a lazily-initializing
 * engine can hang /health entirely (the event-loop trap) — a hang reads as
 * "starting", which is honest.
 *
 * The full EngineClient seam (generate/poll) lands in M2; this module stays the
 * single place that interprets engine health.
 */
import { env } from "@/lib/env";

export type EngineState = "offline" | "starting" | "ready";

export interface EngineStatus {
  state: EngineState;
  /** DiT + VAE + text encoder loaded — generation possible. */
  modelsInitialized: boolean;
  /** 5Hz LM loaded — Enhance / Simple mode / CoT available. */
  llmInitialized: boolean;
  /** Configured primary DiT name as reported (NOT a load indicator). */
  loadedModel: string | null;
  loadedLmModel: string | null;
}

/** Engine /health payload subset we consume (envelope.data). */
interface EngineHealthData {
  models_initialized?: boolean;
  llm_initialized?: boolean;
  loaded_model?: string | null;
  loaded_lm_model?: string | null;
}

const OFFLINE: EngineStatus = {
  state: "offline",
  modelsInitialized: false,
  llmInitialized: false,
  loadedModel: null,
  loadedLmModel: null,
};

export async function probeEngine(timeoutMs = 3000): Promise<EngineStatus> {
  try {
    const res = await fetch(`${env.ENGINE_URL}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return OFFLINE;
    const body = (await res.json()) as { data?: EngineHealthData };
    const data = body.data ?? {};
    const modelsInitialized = data.models_initialized === true;
    return {
      state: modelsInitialized ? "ready" : "starting",
      modelsInitialized,
      llmInitialized: data.llm_initialized === true,
      loadedModel: data.loaded_model ?? null,
      loadedLmModel: data.loaded_lm_model ?? null,
    };
  } catch (err) {
    // Discriminate the two failure modes (verified distinguishable on Node 26):
    //  - TimeoutError: TCP connected but no response — on localhost this is the
    //    engine's lazy-init event-loop hang (ENGINE_NOTES §2), i.e. "starting".
    //  - TypeError/ECONNREFUSED: nothing listening — genuinely "offline".
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ...OFFLINE, state: "starting" };
    }
    return OFFLINE;
  }
}
