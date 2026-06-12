/**
 * lib/engine/acestep.ts — AceStepClient: the real adapter onto ACE-Step 1.5's
 * REST API, written strictly against the M0-verified contract (docs/ENGINE_NOTES.md).
 *
 * Contract details encoded here (all M0-verified, see ENGINE_NOTES §3):
 *  - Envelope: {data, code, error, timestamp, extra}; some endpoints return
 *    HTTP 200 with body code 500 — both layers are checked.
 *  - /release_task: explicit per-take seeds (use_random_seed:false), wav master
 *    format, batch_size client-clamped; default would be 2 takes if omitted.
 *  - /query_result: `result` is a JSON-ENCODED STRING of an array; status int
 *    0=queued|running, 1=succeeded, 2=failed; two result shapes exist (rich
 *    disk-cache vs slim store-fallback) — all rich fields are optional here.
 *  - Failures normally carry NO error text — we synthesize a message and attach
 *    the last progress_text as a hint.
 *  - /v1/init MUST pass init_llm + lm_model_path or a later lazy init silently
 *    loads the 0.6B LM instead of the pinned 1.7B.
 *  - /format_input: 503 ⇒ LM disabled; envelope code 500 ⇒ LM generation failed.
 */
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "@/lib/env";
import {
  type EngineClient,
  type EngineHealth,
  type EngineTake,
  type EngineTaskStatus,
  type EnhanceRequest,
  type EnhanceResult,
  type GenerateRequest,
  EngineLmUnavailableError,
  EngineOfflineError,
  stripLmArtifacts,
} from "./types";

/** Engine response envelope (ENGINE_NOTES §3). */
interface Envelope<T> {
  data: T | null;
  code: number;
  error: string | null;
}

/** Parsed element of the /query_result `result` array. Rich fields optional:
 *  the store-fallback shape omits them (ENGINE_NOTES §3). */
interface ResultElement {
  file?: string;
  status?: number;
  progress?: number;
  stage?: string;
  prompt?: string;
  lyrics?: string;
  seed_value?: string;
  lm_model?: string;
  dit_model?: string;
  metas?: {
    bpm?: number | string | null;
    duration?: number | string | null;
    keyscale?: string | null;
    timesignature?: string | null;
  };
}

export class AceStepClient implements EngineClient {
  constructor(private readonly baseUrl: string = env.ENGINE_URL) {}

  /** fetch wrapper: distinguishes offline (throw) from HTTP-level failures. */
  private async request<T>(
    path: string,
    init?: RequestInit & { timeoutMs?: number },
  ): Promise<Envelope<T>> {
    const { timeoutMs = 10_000, ...rest } = init ?? {};
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...rest,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new EngineOfflineError(`Engine timed out on ${path}`);
      }
      throw new EngineOfflineError(`Engine unreachable on ${path}`);
    }
    if (res.status === 503 && (path === "/format_input" || path === "/v1/create_sample")) {
      // Only the LM plan endpoints use 503 for "LM not initialized"
      // (ENGINE_NOTES §3) — a 503 elsewhere is a generic server error.
      throw new EngineLmUnavailableError();
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Engine HTTP ${res.status} on ${path}: ${detail.slice(0, 300)}`);
    }
    return (await res.json()) as Envelope<T>;
  }

  async health(): Promise<EngineHealth> {
    try {
      const body = await this.request<{
        models_initialized?: boolean;
        llm_initialized?: boolean;
        loaded_model?: string | null;
        loaded_lm_model?: string | null;
      }>("/health", { timeoutMs: 3000 });
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
      if (err instanceof EngineOfflineError) {
        // A timeout (TCP connected, no response) is the engine's lazy-init
        // event-loop hang — report "starting", not "offline" (ENGINE_NOTES §2).
        const starting = err.message.includes("timed out");
        return {
          state: starting ? "starting" : "offline",
          modelsInitialized: false,
          llmInitialized: false,
          loadedModel: null,
          loadedLmModel: null,
        };
      }
      throw err;
    }
  }

  async warmUp(): Promise<void> {
    // Runs in the engine's thread executor — /health stays responsive. Slow by
    // nature (~45 s with weights on disk; much longer on first-ever download).
    const body = await this.request<unknown>("/v1/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        init_llm: true,
        lm_model_path: env.ENGINE_INIT_LM_MODEL,
      }),
      timeoutMs: 900_000,
    });
    if (body.code !== 200) {
      throw new Error(`Engine warm-up failed: ${body.error ?? `code ${body.code}`}`);
    }
  }

  async generate(req: GenerateRequest): Promise<{ taskId: string }> {
    const batchSize = Math.max(1, Math.min(4, req.batchSize));
    const payload: Record<string, unknown> = {
      prompt: req.prompt,
      lyrics: req.lyrics,
      batch_size: batchSize,
      // Simple Mode: the LM writes lyrics/caption/metas from the description.
      // Without this, a vocal forge with empty lyrics renders an INSTRUMENTAL
      // (engine: is_instrumental("") — ENGINE_NOTES §3). The LM's plan
      // replaces request metas wholesale (duration included), so a requested
      // duration goes in as a textual hint — best effort, live-verified.
      ...(req.simpleMode
        ? {
            sample_mode: true,
            sample_query: req.durationS
              ? `${req.prompt} (target length: about ${Math.round(req.durationS)} seconds)`
              : req.prompt,
          }
        : {}),
      // Reproducibility requires explicit seeds (ENGINE_NOTES §3).
      use_random_seed: false,
      seed: req.seeds.slice(0, batchSize).join(","),
      // wav = 16-bit PCM 48 kHz master (M0-verified); mp3 derived via our ffmpeg.
      audio_format: "wav",
      vocal_language: req.vocalLanguage ?? "en",
    };
    if (req.durationS !== undefined) {
      // DiT-only path has no upper clamp server-side — clamp here (ENGINE_NOTES §3).
      payload.audio_duration = Math.max(10, Math.min(600, req.durationS));
    }
    if (req.bpm !== undefined) payload.bpm = req.bpm;
    if (req.keyScale !== undefined) payload.key_scale = req.keyScale;
    if (req.timeSignature !== undefined) payload.time_signature = req.timeSignature;

    const body = await this.request<{ task_id?: string }>("/release_task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 30_000,
    });
    const taskId = body.data?.task_id;
    if (!taskId) {
      throw new Error(`Engine accepted the task but returned no task_id (code ${body.code})`);
    }
    return { taskId };
  }

  async getTask(taskId: string): Promise<EngineTaskStatus> {
    const body = await this.request<
      Array<{ task_id: string; status: number; result: string; progress_text?: string }>
    >("/query_result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id_list: [taskId] }),
      timeoutMs: 10_000,
    });
    const item = body.data?.[0];
    if (!item) throw new Error("Engine returned no status for task");

    let elements: ResultElement[] = [];
    try {
      const parsed: unknown = JSON.parse(item.result || "[]");
      if (Array.isArray(parsed)) elements = parsed as ResultElement[];
    } catch {
      elements = [];
    }
    const first = elements[0];

    // status int mapping: 0=queued|running, 1=succeeded, 2=failed (ENGINE_NOTES §4).
    if (item.status === 1) {
      const withFiles = elements.filter((el) => el.file);
      if (withFiles.length === 0) {
        // Engine-side audio save failures still report status 1 with file:""
        // elements — a "success" with nothing to download is a failure here.
        return {
          state: "failed",
          progress: 1,
          stage: "failed",
          takes: [],
          error: "Engine reported success but returned no audio files — try forging again.",
        };
      }
      return {
        state: "succeeded",
        progress: 1,
        stage: "succeeded",
        takes: withFiles.map((el, i) => this.toTake(el, i)),
        error: null,
      };
    }
    if (item.status === 2) {
      // The store-fallback shape can carry a real traceback in result[0].error;
      // the normal (cache) path carries nothing — synthesize a message and
      // attach the global progress_text as a hint (ENGINE_NOTES §3).
      const storeError = (first as { error?: string } | undefined)?.error?.trim();
      const hint = item.progress_text?.trim();
      return {
        state: "failed",
        progress: first?.progress ?? 0,
        stage: first?.stage ?? "failed",
        takes: [],
        error: storeError
          ? `Engine generation failed: ${storeError.split("\n").at(-1)?.slice(0, 400)}`
          : hint
            ? `Engine generation failed (last engine output: ${hint.slice(0, 400)})`
            : "Engine generation failed",
      };
    }
    // status 0: queued or running — running once any progress exists. NOTE:
    // unknown/expired task ids also report status 0 with an empty result; the
    // caller (queue) owns the poll timeout that catches that case.
    const progress = first?.progress ?? 0;
    return {
      state: progress > 0 ? "running" : "queued",
      progress,
      stage: first?.stage ?? null,
      takes: [],
      error: null,
    };
  }

  private toTake(el: ResultElement, index: number): EngineTake {
    const metas = el.metas ?? {};
    const num = (v: number | string | null | undefined): number | null => {
      if (v === null || v === undefined || v === "N/A") return null;
      const n = typeof v === "number" ? v : parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };
    const str = (v: string | null | undefined): string | null =>
      v && v !== "N/A" ? v : null;
    // file is "/v1/audio?path=<urlencoded absolute path>" — ext from the path.
    let fileExt = "wav";
    try {
      const encoded = (el.file ?? "").split("path=")[1] ?? "";
      const m = decodeURIComponent(encoded).match(/\.(\w+)$/);
      if (m?.[1]) fileExt = m[1].toLowerCase();
    } catch {
      /* keep default */
    }
    // seed_value is the comma-joined list for the WHOLE batch on every
    // element — pick this take's own entry by position.
    const seedList = (el.seed_value ?? "").split(",").map((s) => s.trim());
    const seed = str(seedList[index] ?? seedList[0]);
    // LM-written text can carry token artifacts (observed live in Simple
    // Mode generation results, not just plan endpoints) — strip everywhere.
    const cleanStr = (v: string | null): string | null =>
      v === null ? null : stripLmArtifacts(v);
    return {
      fileUrl: el.file ?? "",
      fileExt,
      finalPrompt: cleanStr(str(el.prompt)),
      finalLyrics: cleanStr(str(el.lyrics)),
      bpm: num(metas.bpm),
      durationS: num(metas.duration),
      keyScale: str(metas.keyscale),
      timeSignature: str(metas.timesignature),
      seed,
      ditModel: str(el.dit_model),
      lmModel: str(el.lm_model),
    };
  }

  async downloadAudio(fileUrl: string, destPath: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${fileUrl}`, {
        signal: AbortSignal.timeout(120_000),
        cache: "no-store",
      });
    } catch {
      throw new EngineOfflineError("Engine unreachable while downloading audio");
    }
    if (!res.ok || !res.body) {
      throw new Error(`Audio download failed: HTTP ${res.status}`);
    }
    // pipeline() (NOT pipe+finished) — it propagates source-stream errors to
    // the awaiter and destroys both streams; pipe() would turn a mid-stream
    // error (timeout, engine restart) into an uncaught 'error' event that
    // kills the whole server process. Reviewed + empirically verified.
    const tmpPath = `${destPath}.part`;
    const out = fs.createWriteStream(tmpPath);
    try {
      await pipeline(
        Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
        out,
      );
      fs.renameSync(tmpPath, destPath); // atomic: no half-written takes at the final path
    } catch (err) {
      fs.rmSync(tmpPath, { force: true });
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new EngineOfflineError("Engine timed out while streaming audio");
      }
      throw err;
    }
  }

  async enhance(req: EnhanceRequest): Promise<EnhanceResult> {
    const paramObj: Record<string, unknown> = {};
    if (req.durationS !== undefined) paramObj.duration = req.durationS;
    if (req.bpm !== undefined) paramObj.bpm = req.bpm;
    if (req.keyScale !== undefined) paramObj.key = req.keyScale;
    if (req.timeSignature !== undefined) paramObj.time_signature = req.timeSignature;
    if (req.vocalLanguage !== undefined) paramObj.language = req.vocalLanguage;

    const body = await this.request<{
      caption?: string;
      lyrics?: string;
      bpm?: number | null;
      key_scale?: string;
      time_signature?: string;
      duration?: number | null;
      vocal_language?: string;
    }>("/format_input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: req.prompt, lyrics: req.lyrics, param_obj: paramObj }),
      timeoutMs: 120_000,
    });
    // LM generation failures come back HTTP 200 with envelope code 500 (ENGINE_NOTES §3).
    if (body.code !== 200 || !body.data) {
      throw new Error(`Enhance failed: ${body.error ?? `engine code ${body.code}`}`);
    }
    const d = body.data;
    return {
      caption: stripLmArtifacts(d.caption ?? ""),
      lyrics: stripLmArtifacts(d.lyrics ?? ""),
      bpm: d.bpm ?? null,
      keyScale: d.key_scale ?? "",
      timeSignature: d.time_signature ?? "",
      durationS: d.duration ?? null,
      vocalLanguage: d.vocal_language ?? "unknown",
    };
  }
}
