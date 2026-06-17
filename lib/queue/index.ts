/**
 * lib/queue/index.ts — the in-process job queue (spec §8). Boring on purpose.
 *
 * Architecture: a module-level singleton in the Next.js server process, cached
 * on globalThis so dev-mode HMR never spawns duplicate workers. Lazy init on
 * first API hit. Concurrency 1 toward the engine (one GPU, serial generation).
 *
 * Data flow for a generate job:
 *   enqueue(payload) → jobs row (queued) → worker picks it up (running)
 *   → ensure engine ready (warmUp if lazily booted) → engine.generate()
 *   → poll engine.getTask() every pollMs, persisting progress
 *   → on success: download each take into DATA_DIR/audio/<songId>/,
 *     insert one songs row per take (shared variationGroupId) → job succeeded
 *   → on failure/timeout: job failed with an actionable message.
 *
 * Restart semantics (spec §8): on boot, re-enqueue rows left "queued" and fail
 * orphaned "running" rows — the engine task they were tracking is lost to us
 * (its in-memory store may also have restarted), so honesty beats guessing.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { asc, and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getEngineClient } from "@/lib/engine";
import {
  EngineOfflineError,
  type EngineClient,
  type GenerateRequest,
} from "@/lib/engine/types";
import { env } from "@/lib/env";
import { separateStems } from "@/lib/audio/demucs";
import { transcribeToMidi, type MidiSource } from "@/lib/audio/basic-pitch";
import { getSong, listStemsForSong, songAudioAbsPath } from "@/lib/songs/queries";

/** Payload of a "generate" job (validated by the /api/generate zod schema). */
export interface GenerateJobPayload {
  prompt: string;
  lyrics: string;
  instrumental: boolean;
  durationS?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  vocalLanguage?: string;
  variations: number;
  /** Optional user seed — take i uses seed+i for reproducible variation sets. */
  seed?: number;
}

/** Payload of a "stems" job — separate one song into four tracks. */
export interface StemsJobPayload {
  songId: string;
}

/** Payload of a "midi" job — transcribe master or one stem to MIDI. */
export interface MidiJobPayload {
  songId: string;
  source: MidiSource;
}

export interface QueueOptions {
  engine?: EngineClient;
  /** Engine poll interval (default 1000 ms; tests use ~10 ms). */
  pollMs?: number;
  /** Absolute per-job budget. Must exceed the engine's own 600 s watchdog —
   *  also catches expired/unknown task ids that poll as "queued" forever. */
  timeoutMs?: number;
}

export class Queue {
  private engine: EngineClient;
  private pollMs: number;
  private timeoutMs: number;
  private working = false;
  /** Ephemeral per-job stage text for the UI (lost on restart — progress isn't). */
  readonly stages = new Map<string, string>();

  constructor(opts: QueueOptions = {}) {
    this.engine = opts.engine ?? getEngineClient();
    this.pollMs = opts.pollMs ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 900_000;
    this.recover();
  }

  /** Boot recovery — see module header. */
  private recover(): void {
    db.update(schema.jobs)
      .set({
        status: "failed",
        error: "Interrupted by an app restart — please forge again.",
        finishedAt: Date.now(),
      })
      .where(eq(schema.jobs.status, "running"))
      .run();
    // queued rows simply remain queued; ensureWorker() below picks them up.
    this.ensureWorker();
  }

  enqueue(type: "generate", payload: GenerateJobPayload): string;
  enqueue(type: "stems", payload: StemsJobPayload): string;
  enqueue(type: "midi", payload: MidiJobPayload): string;
  enqueue(
    type: "generate" | "stems" | "midi",
    payload: GenerateJobPayload | StemsJobPayload | MidiJobPayload,
  ): string {
    const id = crypto.randomUUID();
    const songId =
      type === "stems"
        ? (payload as StemsJobPayload).songId
        : type === "midi"
          ? (payload as MidiJobPayload).songId
          : null;
    db.insert(schema.jobs)
      .values({
        id,
        type,
        status: "queued",
        payload: JSON.stringify(payload),
        songId,
        createdAt: Date.now(),
      })
      .run();
    this.ensureWorker();
    return id;
  }

  /** Single-flight worker loop: drains queued jobs strictly one at a time.
   *  The loop promise must NEVER reject — an unhandled rejection would kill
   *  the server process — so every iteration is individually guarded. */
  private ensureWorker(): void {
    if (this.working) return;
    this.working = true;
    void (async () => {
      try {
        for (;;) {
          const job = db
            .select()
            .from(schema.jobs)
            .where(eq(schema.jobs.status, "queued"))
            .orderBy(asc(schema.jobs.createdAt))
            .limit(1)
            .get();
          if (!job) break;
          try {
            await this.runJob(job);
          } catch (err) {
            // runJob handles its own failures; this guards the guard (e.g. a
            // db error while writing the failure row).
            console.error(`[queue] job ${job.id} crashed outside runJob:`, err);
          }
        }
      } catch (err) {
        console.error("[queue] worker loop error:", err);
      } finally {
        this.working = false;
      }
    })();
  }

  private async runJob(job: typeof schema.jobs.$inferSelect): Promise<void> {
    db.update(schema.jobs)
      .set({ status: "running", startedAt: Date.now(), progress: 0 })
      .where(eq(schema.jobs.id, job.id))
      .run();
    try {
      if (job.type === "generate") {
        await this.runGenerate(job.id, JSON.parse(job.payload) as GenerateJobPayload);
      } else if (job.type === "stems") {
        await this.runStems(job.id, JSON.parse(job.payload) as StemsJobPayload);
      } else if (job.type === "midi") {
        await this.runMidi(job.id, JSON.parse(job.payload) as MidiJobPayload);
      } else {
        throw new Error(`Unsupported job type: ${job.type}`);
      }
    } catch (err) {
      const message =
        err instanceof EngineOfflineError
          ? "Engine offline — start it with scripts/dev.sh and try again."
          : err instanceof Error
            ? err.message
            : "Unknown error";
      db.update(schema.jobs)
        .set({ status: "failed", error: message, finishedAt: Date.now() })
        .where(eq(schema.jobs.id, job.id))
        .run();
    } finally {
      this.stages.delete(job.id);
    }
  }

  private async runGenerate(jobId: string, payload: GenerateJobPayload): Promise<void> {
    // 1. Engine readiness. A lazily-booted engine needs the explicit warm-up
    //    (thread-executor path keeps /health live; pins the 1.7B LM).
    this.stages.set(jobId, "Checking engine...");
    const health = await this.engine.health();
    if (health.state === "offline") {
      throw new EngineOfflineError();
    }
    // Warm up when EITHER component is missing: skipping warmUp while only the
    // LM is unloaded would let the engine lazy-load the small 0.6B model
    // instead of the pinned 1.7B (the silent-downgrade trap, ENGINE_NOTES §2).
    if (!health.modelsInitialized || !health.llmInitialized) {
      this.stages.set(jobId, "Warming up the engine (first run takes a minute)...");
      await this.engine.warmUp();
    }

    // 2. Submit. One batched call per forge — N takes, one queue slot (M0 decision).
    const variations = Math.max(1, Math.min(4, payload.variations));
    const seeds = expandSeeds(payload.seed, variations);
    const req: GenerateRequest = {
      prompt: payload.prompt,
      // Engine contract: "[inst]" requests an instrumental render (ENGINE_NOTES §3).
      lyrics: payload.instrumental ? "[inst]" : payload.lyrics,
      // Vocal forge with no user lyrics ⇒ engine Simple Mode, or the engine
      // would treat empty lyrics as instrumental — the LM writes the lyrics.
      simpleMode: !payload.instrumental && !payload.lyrics.trim(),
      durationS: payload.durationS,
      bpm: payload.bpm,
      keyScale: payload.keyScale,
      timeSignature: payload.timeSignature,
      vocalLanguage: payload.vocalLanguage,
      batchSize: variations,
      seeds,
    };
    const { taskId } = await this.engine.generate(req);

    // 3. Poll to terminal state, persisting progress for the queue-strip UI.
    //    Transient poll failures are tolerated (a multi-minute render must not
    //    die because one 1s status request hiccuped) — only consecutive
    //    failures beyond the budget fail the job.
    const deadline = Date.now() + this.timeoutMs;
    let consecutivePollFailures = 0;
    let status = await this.engine.getTask(taskId);
    for (;;) {
      if (status.state !== "queued" && status.state !== "running") break;
      if (Date.now() > deadline) {
        throw new Error(
          "Generation timed out — the engine may have restarted mid-job. Try forging again.",
        );
      }
      db.update(schema.jobs)
        .set({ progress: status.progress })
        .where(eq(schema.jobs.id, jobId))
        .run();
      if (status.stage) this.stages.set(jobId, status.stage);
      await sleep(this.pollMs);
      try {
        status = await this.engine.getTask(taskId);
        consecutivePollFailures = 0;
      } catch (err) {
        consecutivePollFailures += 1;
        if (consecutivePollFailures >= 5) throw err;
      }
    }
    if (status.state === "failed") {
      throw new Error(status.error ?? "Engine generation failed");
    }

    if (status.takes.length === 0) {
      // Belt-and-braces: the client already maps this to failed, but the queue
      // owns job semantics — a "success" with no audio must never reach users.
      throw new Error("Engine reported success but returned no audio files — try forging again.");
    }

    // 4. Materialize takes in two phases so a mid-batch download failure can't
    //    half-populate the library: (A) download EVERY take to disk; (B) only
    //    then insert the songs rows. On any download error, remove what
    //    arrived and fail the whole job — variations are one atomic forge.
    this.stages.set(jobId, "Saving songs...");
    const variationGroupId = crypto.randomUUID();
    const staged: Array<{ songId: string; relPath: string; absPath: string }> = [];
    const createdDirs: string[] = [];
    try {
      for (const take of status.takes) {
        const songId = crypto.randomUUID();
        const relPath = path.join(songId, `take.${take.fileExt}`);
        const absPath = path.join(env.audioDir, relPath);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        createdDirs.push(path.dirname(absPath)); // track BEFORE download: a failed take's dir is litter too
        await this.engine.downloadAudio(take.fileUrl, absPath);
        staged.push({ songId, relPath, absPath });
      }
    } catch (err) {
      for (const dir of createdDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      throw err;
    }

    const songIds: string[] = [];
    for (const [i, take] of status.takes.entries()) {
      const { songId, relPath } = staged[i]!;
      const title = deriveTitle(payload.prompt, i, status.takes.length);
      const tags = JSON.stringify(deriveTags(payload.prompt));
      db.insert(schema.songs)
        .values({
          id: songId,
          title,
          prompt: payload.prompt,
          lyrics: payload.instrumental ? null : (take.finalLyrics ?? payload.lyrics ?? null),
          tags,
          bpm: take.bpm !== null ? Math.round(take.bpm) : null,
          keyScale: take.keyScale,
          timeSignature: take.timeSignature,
          durationS: take.durationS,
          // Our per-take seed, not the engine-reported one (belt: the client
          // also splits the batch seed_value, but ours is authoritative).
          seed: seeds[i] !== undefined ? String(seeds[i]) : (take.seed ?? null),
          model: take.ditModel ?? "unknown",
          variationGroupId,
          audioPath: relPath,
          lrc: null, // not available over REST (M0) — see ENGINE_NOTES §7
          qualityScore: null, // not available over REST (M0)
          artSeed: artSeedFor(songId, title, tags),
          createdAt: Date.now(),
        })
        .run();
      songIds.push(songId);
    }

    db.update(schema.jobs)
      .set({
        status: "succeeded",
        progress: 1,
        result: JSON.stringify({ songIds, variationGroupId }),
        songId: songIds[0] ?? null,
        finishedAt: Date.now(),
      })
      .where(eq(schema.jobs.id, jobId))
      .run();
  }

  private async runStems(jobId: string, payload: StemsJobPayload): Promise<void> {
    const song = getSong(payload.songId);
    if (!song) throw new Error("Song not found — it may have been deleted.");
    const masterAbs = songAudioAbsPath(song);
    if (!masterAbs || !fs.existsSync(masterAbs)) {
      throw new Error("Master audio missing on disk — cannot separate stems.");
    }

    // Replace any prior stems for this song (re-run is allowed).
    db.delete(schema.stems).where(eq(schema.stems.songId, payload.songId)).run();

    const stemAbs = await separateStems(masterAbs, payload.songId, (fraction, stage) => {
      db.update(schema.jobs).set({ progress: fraction }).where(eq(schema.jobs.id, jobId)).run();
      this.stages.set(jobId, stage);
    });

    const stemIds: string[] = [];
    const now = Date.now();
    for (const [stemName, absPath] of Object.entries(stemAbs)) {
      const id = crypto.randomUUID();
      const relPath = path.relative(env.audioDir, absPath);
      db.insert(schema.stems)
        .values({
          id,
          songId: payload.songId,
          stemName: stemName as "vocals" | "drums" | "bass" | "other",
          path: relPath,
          createdAt: now,
        })
        .run();
      stemIds.push(id);
    }

    db.update(schema.jobs)
      .set({
        status: "succeeded",
        progress: 1,
        result: JSON.stringify({ stemIds, songId: payload.songId }),
        songId: payload.songId,
        finishedAt: Date.now(),
      })
      .where(eq(schema.jobs.id, jobId))
      .run();
  }

  private async runMidi(jobId: string, payload: MidiJobPayload): Promise<void> {
    const song = getSong(payload.songId);
    if (!song) throw new Error("Song not found — it may have been deleted.");

    let inputAbs: string | null = null;
    if (payload.source === "master") {
      inputAbs = songAudioAbsPath(song);
    } else {
      const stem = listStemsForSong(payload.songId).find((s) => s.stemName === payload.source);
      if (!stem) {
        throw new Error(`Stem "${payload.source}" not ready — generate stems first, or transcribe from master.`);
      }
      inputAbs = path.resolve(env.audioDir, stem.path);
      if (!inputAbs.startsWith(env.audioDir + path.sep) || !fs.existsSync(inputAbs)) {
        throw new Error(`Stem audio missing on disk for "${payload.source}".`);
      }
    }
    if (!inputAbs || !fs.existsSync(inputAbs)) {
      throw new Error("Source audio missing on disk — cannot transcribe to MIDI.");
    }

    const midiAbs = await transcribeToMidi(inputAbs, payload.songId, payload.source, (fraction, stage) => {
      db.update(schema.jobs).set({ progress: fraction }).where(eq(schema.jobs.id, jobId)).run();
      this.stages.set(jobId, stage);
    });

    const id = crypto.randomUUID();
    const relPath = path.relative(env.audioDir, midiAbs);
    const now = Date.now();
    db.delete(schema.midiTracks)
      .where(
        and(eq(schema.midiTracks.songId, payload.songId), eq(schema.midiTracks.source, payload.source)),
      )
      .run();

    db.insert(schema.midiTracks)
      .values({
        id,
        songId: payload.songId,
        source: payload.source,
        path: relPath,
        createdAt: now,
      })
      .run();

    db.update(schema.jobs)
      .set({
        status: "succeeded",
        progress: 1,
        result: JSON.stringify({ midiId: id, songId: payload.songId, source: payload.source }),
        songId: payload.songId,
        finishedAt: Date.now(),
      })
      .where(eq(schema.jobs.id, jobId))
      .run();
  }
}

/** Take i uses seed+i: one user seed reproduces the whole variation set. */
export function expandSeeds(seed: number | undefined, count: number): number[] {
  if (seed !== undefined && Number.isFinite(seed)) {
    return Array.from({ length: count }, (_, i) => (seed + i) >>> 0);
  }
  return Array.from({ length: count }, () => crypto.randomInt(0, 0xffffffff));
}

/** Title from the user's prompt: first ~7 words, capitalized. Editable later (M4). */
export function deriveTitle(prompt: string, index: number, total: number): string {
  const words = prompt.trim().split(/\s+/).slice(0, 7).join(" ");
  const base = words.charAt(0).toUpperCase() + words.slice(1);
  const trimmed = base.length > 60 ? `${base.slice(0, 57)}...` : base;
  return total > 1 ? `${trimmed} (take ${index + 1})` : trimmed;
}

/** Cheap tag extraction: comma-separated fragments of the prompt become tags. */
export function deriveTags(prompt: string): string[] {
  return prompt
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1 && t.length <= 32)
    .slice(0, 6);
}

/** Deterministic art seed (spec §9.4): hash of id+title+tags. */
export function artSeedFor(id: string, title: string, tags: string): string {
  return crypto.createHash("sha1").update(`${id}${title}${tags}`).digest("hex").slice(0, 16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const globalForQueue = globalThis as unknown as { __wavesmithQueue?: Queue };

/** The app-wide queue singleton (HMR-safe). Lazy: first API hit constructs it,
 *  which also runs boot recovery. */
export function getQueue(): Queue {
  if (!globalForQueue.__wavesmithQueue) {
    globalForQueue.__wavesmithQueue = new Queue();
  }
  return globalForQueue.__wavesmithQueue;
}
