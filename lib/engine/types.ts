/**
 * lib/engine/types.ts — the EngineClient seam (spec §6).
 *
 * This interface is owned by Wavesmith and is the ONLY way app code talks to
 * the music engine. Two implementations exist: AceStepClient (real, maps onto
 * the M0-verified REST contract in docs/ENGINE_NOTES.md) and MockEngineClient
 * (instant canned responses; powers the test suite and demo mode). Selection
 * happens in lib/engine/index.ts based on MOCK_ENGINE.
 *
 * Every method exists for a concrete reason:
 *   health()        — drives /api/health and the first-run honesty banner (§9.1)
 *   warmUp()        — POST /v1/init pre-warm; avoids the engine's lazy-init
 *                     event-loop hang and the silent-0.6B-LM trap (ENGINE_NOTES §2)
 *   generate()      — one call per Forge; batch_size = variation count (§8)
 *   getTask()       — 1s polling source for job progress (§3)
 *   downloadAudio() — pulls finished takes out of the engine's temp dir before
 *                     its 7-day cache expiry (ENGINE_NOTES §3)
 *   enhance()       — POST /format_input; backs the Advanced-tab Enhance button
 *                     (M0 verified the LM plan is fetchable as a distinct step)
 */

export type EngineState = "offline" | "starting" | "ready";

export interface EngineHealth {
  state: EngineState;
  /** DiT + VAE + text encoder loaded — generation possible. */
  modelsInitialized: boolean;
  /** 5Hz LM loaded — Enhance / Simple mode / CoT available. */
  llmInitialized: boolean;
  /** Configured primary DiT name as reported (NOT a load indicator). */
  loadedModel: string | null;
  loadedLmModel: string | null;
}

export interface GenerateRequest {
  /** Music description (the engine LM rewrites it into a caption by default). */
  prompt: string;
  /** User lyrics, passed VERBATIM to the engine (M0-verified). Empty or "[inst]" ⇒ instrumental. */
  lyrics: string;
  /** Engine Simple Mode: the LM invents lyrics/caption/metadata from the
   *  prompt (sample_mode + sample_query). REQUIRED for vocal forges with no
   *  user lyrics — empty lyrics would otherwise render an instrumental
   *  (ENGINE_NOTES §3: is_instrumental("") is true). */
  simpleMode?: boolean;
  /** Target duration in seconds; omit for engine-auto. Clamped 10–600 client-side. */
  durationS?: number;
  bpm?: number;
  /** e.g. "F# minor" — engine vocabulary, not validated client-side. */
  keyScale?: string;
  /** "2" | "3" | "4" | "6" per engine contract. */
  timeSignature?: string;
  vocalLanguage?: string;
  /** When true, send use_cot_language:false so the engine LM keeps vocal_language. */
  lockVocalLanguage?: boolean;
  /** Takes per call, 1–4 (engine has NO server-side clamp on MPS — we clamp). */
  batchSize: number;
  /** One explicit seed per take — reproducibility requires explicit seeds
   *  (random-mode seed_value is unreliable, ENGINE_NOTES §3). */
  seeds: number[];
}

export interface EngineTake {
  /** Engine-relative download URL ("/v1/audio?path=..."). */
  fileUrl: string;
  /** Audio file extension ("wav" for real renders; the mock serves "mp3"). */
  fileExt: string;
  /** Final caption (LM-rewritten prompt) when available. */
  finalPrompt: string | null;
  /** Final lyrics as the engine rendered them. */
  finalLyrics: string | null;
  bpm: number | null;
  durationS: number | null;
  keyScale: string | null;
  timeSignature: string | null;
  /** Per-take seed actually used. */
  seed: string | null;
  /** Engine model names for provenance. */
  ditModel: string | null;
  lmModel: string | null;
}

export interface EngineTaskStatus {
  state: "queued" | "running" | "succeeded" | "failed";
  /** 0..1 — engine reports ≥1% granularity while running (M0-verified). */
  progress: number;
  /** Free-text stage ("Generating music...", "Decoding audio...", ...). */
  stage: string | null;
  /** Populated on success: one entry per take. */
  takes: EngineTake[];
  /** Failure hint. The engine's normal path carries NO error text
   *  (ENGINE_NOTES §3) — this is a generic message + progress_text snapshot. */
  error: string | null;
}

export interface EnhanceRequest {
  prompt: string;
  lyrics: string;
  durationS?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  vocalLanguage?: string;
}

export interface EnhanceResult {
  caption: string;
  lyrics: string;
  bpm: number | null;
  keyScale: string;
  timeSignature: string;
  durationS: number | null;
  vocalLanguage: string;
}

export interface EngineClient {
  health(): Promise<EngineHealth>;
  /** Idempotent: loads DiT + the pinned LM. Resolves when the engine is ready. */
  warmUp(): Promise<void>;
  generate(req: GenerateRequest): Promise<{ taskId: string }>;
  getTask(taskId: string): Promise<EngineTaskStatus>;
  /** Streams an engine take to a local file. */
  downloadAudio(fileUrl: string, destPath: string): Promise<void>;
  /** LM plan-only enhancement. Throws EngineLmUnavailableError when the LM is off. */
  enhance(req: EnhanceRequest): Promise<EnhanceResult>;
}

/** Engine reachable but the LM is not initialized/enabled (HTTP 503 from plan endpoints). */
export class EngineLmUnavailableError extends Error {
  constructor(message = "Engine LM not available") {
    super(message);
    this.name = "EngineLmUnavailableError";
  }
}

/** Engine process unreachable (connection refused / timeout). */
export class EngineOfflineError extends Error {
  constructor(message = "Engine offline") {
    super(message);
    this.name = "EngineOfflineError";
  }
}

/** Strip LM token artifacts like <|audio_code_61104|> (observed in M0 probes). */
export function stripLmArtifacts(text: string): string {
  return text.replace(/<\|audio_code_\d+\|>/g, "").replace(/<\|endoftext\|>/g, "");
}
