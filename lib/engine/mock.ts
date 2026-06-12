/**
 * lib/engine/mock.ts — MockEngineClient: instant canned engine (spec §6.1).
 *
 * Selected by MOCK_ENGINE=1. Powers (a) the unit test suite with no engine or
 * GPU, (b) Playwright smoke tests, (c) demo mode so users can tour the UI
 * before installing the engine. Audio comes from the bundled demo clip
 * (public/demo-clip.mp3 — a real M0 render, encoded per spec §6.1).
 *
 * Behavior model: each generate() creates an in-memory task that advances one
 * lifecycle step per getTask() poll (queued → running 50% → succeeded), so
 * queue logic exercises real state transitions without timers.
 */
import fs from "node:fs";
import path from "node:path";
import {
  type EngineClient,
  type EngineHealth,
  type EngineTake,
  type EngineTaskStatus,
  type EnhanceRequest,
  type EnhanceResult,
  type GenerateRequest,
} from "./types";

const DEMO_CLIP = path.resolve("public/demo-clip.mp3");

interface MockTask {
  req: GenerateRequest;
  polls: number;
}

export class MockEngineClient implements EngineClient {
  private tasks = new Map<string, MockTask>();
  private counter = 0;
  /** Tests may force the next task to fail. */
  failNext = false;

  async health(): Promise<EngineHealth> {
    return {
      state: "ready",
      modelsInitialized: true,
      llmInitialized: true,
      loadedModel: "mock",
      loadedLmModel: "mock",
    };
  }

  async warmUp(): Promise<void> {
    // Mock engine is always warm.
  }

  async generate(req: GenerateRequest): Promise<{ taskId: string }> {
    const taskId = `mock-${++this.counter}`;
    this.tasks.set(taskId, { req, polls: 0 });
    return { taskId };
  }

  async getTask(taskId: string): Promise<EngineTaskStatus> {
    const task = this.tasks.get(taskId);
    if (!task) {
      // Mirrors the real engine: unknown ids look queued forever (ENGINE_NOTES §3).
      return { state: "queued", progress: 0, stage: null, takes: [], error: null };
    }
    task.polls += 1;
    if (task.polls === 1) {
      return { state: "running", progress: 0.5, stage: "Generating music (mock)...", takes: [], error: null };
    }
    if (this.failNext) {
      this.failNext = false;
      this.tasks.delete(taskId);
      return { state: "failed", progress: 0.5, stage: "failed", takes: [], error: "Mock generation failed" };
    }
    const batch = Math.max(1, Math.min(4, task.req.batchSize));
    const takes: EngineTake[] = Array.from({ length: batch }, (_, i) => ({
      fileUrl: `/mock/audio/${taskId}/${i}`,
      fileExt: "mp3", // the bundled demo clip is mp3

      finalPrompt: `${task.req.prompt} (mock enhanced caption)`,
      finalLyrics: task.req.lyrics,
      bpm: 100,
      durationS: 10,
      keyScale: "C major",
      timeSignature: "4",
      seed: String(task.req.seeds[i] ?? i),
      ditModel: "mock",
      lmModel: "mock",
    }));
    this.tasks.delete(taskId);
    return { state: "succeeded", progress: 1, stage: "succeeded", takes, error: null };
  }

  async downloadAudio(_fileUrl: string, destPath: string): Promise<void> {
    // The bundled clip is the mock's audio for every take (spec §6.1).
    fs.copyFileSync(DEMO_CLIP, destPath);
  }

  async enhance(req: EnhanceRequest): Promise<EnhanceResult> {
    return {
      caption: `${req.prompt} — detailed mock caption with rich instrumentation`,
      lyrics: req.lyrics || "[verse]\nMock verse one\n[chorus]\nMock chorus",
      bpm: req.bpm ?? 120,
      keyScale: req.keyScale ?? "A minor",
      timeSignature: req.timeSignature ?? "4",
      durationS: req.durationS ?? 60,
      vocalLanguage: req.vocalLanguage ?? "en",
    };
  }
}
