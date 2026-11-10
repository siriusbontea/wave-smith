/**
 * Queue behavior with the mock engine: the full enqueue → poll → materialize
 * flow, failure paths, restart recovery, and the pure helpers.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "@/lib/db";
import { MockEngineClient } from "@/lib/engine/mock";
import type { EngineHealth } from "@/lib/engine/types";
import {
  Queue,
  artSeedFor,
  deriveTags,
  deriveTitle,
  expandSeeds,
  type GenerateJobPayload,
} from "@/lib/queue";
import { DEMO_EDIT_NOTE } from "@/lib/songs/extend-check";
import { DEMO_CLIP_DURATION_S } from "@/lib/engine/mock";
import { env } from "@/lib/env";

function insertParentSong(): { id: string; abs: string } {
  const id = crypto.randomUUID();
  const rel = path.join(id, "take.mp3");
  const abs = path.join(env.audioDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.copyFileSync(path.resolve("public/demo-clip.mp3"), abs);
  db.insert(schema.songs)
    .values({
      id,
      title: "Night Drive",
      prompt: "dreamy synthwave night drive",
      lyrics: "[verse]\nNeon\n[chorus]\nDrive",
      tags: "[]",
      model: "mock",
      variationGroupId: id,
      audioPath: rel,
      artSeed: "abc",
      durationS: 30,
      createdAt: Date.now(),
    })
    .run();
  return { id, abs };
}

function payload(overrides: Partial<GenerateJobPayload> = {}): GenerateJobPayload {
  return {
    prompt: "dreamy synthwave night drive, retro 80s",
    lyrics: "[verse]\nNeon lights\n[chorus]\nDrive on",
    instrumental: false,
    variations: 2,
    ...overrides,
  };
}

async function waitForJob(jobId: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
    if (job && (job.status === "succeeded" || job.status === "failed")) return job;
    if (Date.now() > deadline) throw new Error("job did not finish in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("Queue (mock engine)", () => {
  let engine: MockEngineClient;
  let queue: Queue;

  beforeEach(() => {
    // Tests in this file share one SQLite db + audio dir — clean slate each.
    db.delete(schema.songs).run();
    db.delete(schema.jobs).run();
    fs.rmSync(env.audioDir, { recursive: true, force: true });
    engine = new MockEngineClient();
    queue = new Queue({ engine, pollMs: 5, timeoutMs: 5000 });
  });

  it("runs a generate job end-to-end: songs rows + audio files + grouping", async () => {
    const jobId = queue.enqueue("generate", payload());
    const job = await waitForJob(jobId);

    expect(job.status).toBe("succeeded");
    expect(job.progress).toBe(1);
    const result = JSON.parse(job.result ?? "{}") as {
      songIds: string[];
      variationGroupId: string;
    };
    expect(result.songIds).toHaveLength(2);
    expect(job.songId).toBe(result.songIds[0]);

    const songs = result.songIds.map(
      (id) => db.select().from(schema.songs).where(eq(schema.songs.id, id)).get()!,
    );
    // Takes from one Forge click share a variation_group_id (spec §5).
    expect(new Set(songs.map((s) => s.variationGroupId)).size).toBe(1);
    expect(songs[0]!.variationGroupId).toBe(result.variationGroupId);
    // Audio downloaded to DATA_DIR/audio/<songId>/take.mp3 (mock serves mp3).
    for (const song of songs) {
      const abs = path.join(env.audioDir, song.audioPath);
      expect(fs.existsSync(abs)).toBe(true);
      expect(fs.statSync(abs).size).toBeGreaterThan(10_000);
    }
    // Titles disambiguate takes; metadata came from the engine result.
    expect(songs[0]!.title).toMatch(/\(take 1\)$/);
    expect(songs[1]!.title).toMatch(/\(take 2\)$/);
    expect(songs[0]!.bpm).toBe(100);
    expect(songs[0]!.lrc).toBeNull(); // not available over REST (M0)
    expect(songs[0]!.qualityScore).toBeNull();
    expect(JSON.parse(songs[0]!.tags)).toContain("retro 80s");
  });

  it("instrumental forge stores null lyrics and sends [inst] to the engine", async () => {
    const generateSpy = vi.spyOn(engine, "generate");
    const jobId = queue.enqueue("generate", payload({ instrumental: true, variations: 1 }));
    const job = await waitForJob(jobId);
    expect(job.status).toBe("succeeded");
    const { songIds } = JSON.parse(job.result!) as { songIds: string[] };
    const song = db.select().from(schema.songs).where(eq(schema.songs.id, songIds[0]!)).get()!;
    expect(song.lyrics).toBeNull();
    // The engine must receive the instrumental sentinel, not the user lyrics.
    expect(generateSpy.mock.calls[0]![0].lyrics).toBe("[inst]");
  });

  it("vocal forge with NO lyrics uses engine Simple Mode and stores LM lyrics", async () => {
    // Empty lyrics + instrumental OFF must NOT render an instrumental: the
    // engine treats empty lyrics as instrumental, so the queue requests
    // Simple Mode (the LM writes the lyrics). This was the M3 review blocker.
    const generateSpy = vi.spyOn(engine, "generate");
    const jobId = queue.enqueue("generate", payload({ lyrics: "", variations: 1 }));
    const job = await waitForJob(jobId);
    expect(job.status).toBe("succeeded");
    expect(generateSpy.mock.calls[0]![0].simpleMode).toBe(true);
    const { songIds } = JSON.parse(job.result!) as { songIds: string[] };
    const song = db.select().from(schema.songs).where(eq(schema.songs.id, songIds[0]!)).get()!;
    expect(song.lyrics).toBeTruthy(); // LM-written, not null/empty
    expect(song.lyrics).toContain("[verse]");
  });

  it("vocal forge WITH lyrics does not use Simple Mode", async () => {
    const generateSpy = vi.spyOn(engine, "generate");
    const jobId = queue.enqueue("generate", payload({ variations: 1 }));
    await waitForJob(jobId);
    expect(generateSpy.mock.calls[0]![0].simpleMode).toBe(false);
    expect(generateSpy.mock.calls[0]![0].lockVocalLanguage).toBe(true);
    expect(generateSpy.mock.calls[0]![0].vocalLanguage).toBe("en");
  });

  it("splits embedded lyrics from the prompt and disables Simple Mode", async () => {
    const generateSpy = vi.spyOn(engine, "generate");
    const jobId = queue.enqueue(
      "generate",
      payload({
        prompt: "dreamy darkwave indie, 95 bpm\nVerse 1:\nNeon fog\nBridge:\nТы мой волк",
        lyrics: "",
        variations: 1,
      }),
    );
    await waitForJob(jobId);
    const req = generateSpy.mock.calls[0]![0];
    expect(req.simpleMode).toBe(false);
    expect(req.lyrics).toContain("Verse 1:");
    expect(req.lyrics).toContain("Ты мой волк");
    expect(req.vocalLanguage).toBe("unknown");
    expect(req.lockVocalLanguage).toBe(true);
  });

  it("passes explicit vocalLanguage through with lock", async () => {
    const generateSpy = vi.spyOn(engine, "generate");
    const jobId = queue.enqueue(
      "generate",
      payload({ vocalLanguage: "ru", variations: 1 }),
    );
    await waitForJob(jobId);
    expect(generateSpy.mock.calls[0]![0].vocalLanguage).toBe("ru");
    expect(generateSpy.mock.calls[0]![0].lockVocalLanguage).toBe(true);
  });

  it("vocal forge sends user lyrics to the engine byte-verbatim (DoD #5 contract)", async () => {
    const generateSpy = vi.spyOn(engine, "generate");
    const lyrics = "[verse]\nExplicit or not, exactly as typed\n[chorus]\nVerbatim!";
    const jobId = queue.enqueue("generate", payload({ lyrics, variations: 1 }));
    await waitForJob(jobId);
    expect(generateSpy.mock.calls[0]![0].lyrics).toBe(lyrics);
  });

  it("warms up a cold engine before generating (the M2 live-gate path, pinned)", async () => {
    // Engine starts cold: health says starting until warmUp() completes;
    // generate() before warm-up is a bug.
    class ColdEngine extends MockEngineClient {
      warm = false;
      override async health(): Promise<EngineHealth> {
        return {
          state: this.warm ? "ready" : "starting",
          modelsInitialized: this.warm,
          llmInitialized: this.warm,
          loadedModel: "acestep-v15-turbo",
          loadedLmModel: this.warm ? "acestep-5Hz-lm-1.7B" : null,
        };
      }
      override async warmUp(): Promise<void> {
        await new Promise((r) => setTimeout(r, 5));
        this.warm = true;
      }
      override async generate(req: Parameters<MockEngineClient["generate"]>[0]) {
        if (!this.warm) throw new Error("generate() called before warm-up completed");
        return super.generate(req);
      }
    }
    const cold = new ColdEngine();
    const q = new Queue({ engine: cold, pollMs: 5, timeoutMs: 5000 });
    const job = await waitForJob(q.enqueue("generate", payload({ variations: 1 })));
    expect(job.status).toBe("succeeded");
    expect(cold.warm).toBe(true);
  });

  it("warms up when only the LM is missing (silent-0.6B-downgrade trap)", async () => {
    class LmColdEngine extends MockEngineClient {
      warmUpCalled = false;
      override async health(): Promise<EngineHealth> {
        return {
          state: "ready",
          modelsInitialized: true,
          llmInitialized: this.warmUpCalled, // DiT loaded, LM not
          loadedModel: "acestep-v15-turbo",
          loadedLmModel: null,
        };
      }
      override async warmUp(): Promise<void> {
        this.warmUpCalled = true;
      }
    }
    const lmCold = new LmColdEngine();
    const q = new Queue({ engine: lmCold, pollMs: 5, timeoutMs: 5000 });
    await waitForJob(q.enqueue("generate", payload({ variations: 1 })));
    expect(lmCold.warmUpCalled).toBe(true);
  });

  it("maps an offline engine to a plain message", async () => {
    class OfflineEngine extends MockEngineClient {
      override async health(): Promise<EngineHealth> {
        return {
          state: "offline",
          modelsInitialized: false,
          llmInitialized: false,
          loadedModel: null,
          loadedLmModel: null,
        };
      }
    }
    const q = new Queue({ engine: new OfflineEngine(), pollMs: 5, timeoutMs: 5000 });
    const job = await waitForJob(q.enqueue("generate", payload()));
    expect(job.status).toBe("failed");
    expect(job.error).toBe("The music engine is not running.");
  });

  it("fails an expired/unknown task via the poll timeout (ENGINE_NOTES §3 safety net)", async () => {
    class ExpiredTaskEngine extends MockEngineClient {
      override async generate() {
        return { taskId: "never-registered" }; // getTask will poll queued forever
      }
    }
    const q = new Queue({ engine: new ExpiredTaskEngine(), pollMs: 5, timeoutMs: 60 });
    const job = await waitForJob(q.enqueue("generate", payload({ variations: 1 })));
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/timed out/i);
    expect(db.select().from(schema.songs).all()).toHaveLength(0);
  });

  it("a mid-batch download failure fails the whole job with no orphan rows or files", async () => {
    class FlakyDownloadEngine extends MockEngineClient {
      downloads = 0;
      override async downloadAudio(fileUrl: string, destPath: string): Promise<void> {
        this.downloads += 1;
        if (this.downloads === 2) throw new Error("stream reset mid-download");
        return super.downloadAudio(fileUrl, destPath);
      }
    }
    const flaky = new FlakyDownloadEngine();
    const q = new Queue({ engine: flaky, pollMs: 5, timeoutMs: 5000 });
    const job = await waitForJob(q.enqueue("generate", payload({ variations: 2 })));
    expect(job.status).toBe("failed");
    expect(job.error).toContain("stream reset");
    // Variations are one atomic forge: nothing half-materialized.
    expect(db.select().from(schema.songs).all()).toHaveLength(0);
    const audioDirs = fs.existsSync(env.audioDir) ? fs.readdirSync(env.audioDir) : [];
    expect(audioDirs).toHaveLength(0);
  });

  it("marks the job failed with the engine's message when generation fails", async () => {
    engine.failNext = true;
    const jobId = queue.enqueue("generate", payload());
    const job = await waitForJob(jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toContain("Mock generation failed");
    // No half-materialized songs.
    const songCount = db.select().from(schema.songs).all().length;
    expect(songCount).toBe(0);
  });

  it("fails orphaned running jobs on boot recovery (restart semantics, spec §8)", async () => {
    db.insert(schema.jobs)
      .values({
        id: "orphan-1",
        type: "generate",
        status: "running",
        payload: JSON.stringify(payload()),
        createdAt: Date.now() - 60_000,
        startedAt: Date.now() - 60_000,
      })
      .run();
    // Constructing a Queue runs recovery — like an app restart.
    new Queue({ engine: new MockEngineClient(), pollMs: 5 });
    const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, "orphan-1")).get()!;
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/restart/i);
  });

  it("re-runs jobs left queued across a restart", async () => {
    db.insert(schema.jobs)
      .values({
        id: "leftover-1",
        type: "generate",
        status: "queued",
        payload: JSON.stringify(payload({ variations: 1 })),
        createdAt: Date.now() - 60_000,
      })
      .run();
    new Queue({ engine: new MockEngineClient(), pollMs: 5 });
    const job = await waitForJob("leftover-1");
    expect(job.status).toBe("succeeded");
  });

  it("runs stems jobs when the song exists (mock demucs)", async () => {
    const songId = crypto.randomUUID();
    const rel = path.join(songId, "take.mp3");
    const abs = path.join(env.audioDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.copyFileSync(path.resolve("public/demo-clip.mp3"), abs);
    db.insert(schema.songs)
      .values({
        id: songId,
        title: "Stems test",
        prompt: "x",
        tags: "[]",
        model: "mock",
        variationGroupId: songId,
        audioPath: rel,
        artSeed: "x",
        createdAt: Date.now(),
      })
      .run();
    const jobId = queue.enqueue("stems", { songId });
    const job = await waitForJob(jobId);
    expect(job.status).toBe("succeeded");
    const stems = db.select().from(schema.stems).where(eq(schema.stems.songId, songId)).all();
    expect(stems).toHaveLength(4);
  });

  it("runs midi jobs when the song exists (mock basic-pitch)", async () => {
    const songId = crypto.randomUUID();
    const rel = path.join(songId, "take.mp3");
    const abs = path.join(env.audioDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.copyFileSync(path.resolve("public/demo-clip.mp3"), abs);
    db.insert(schema.songs)
      .values({
        id: songId,
        title: "MIDI test",
        prompt: "x",
        tags: "[]",
        model: "mock",
        variationGroupId: songId,
        audioPath: rel,
        artSeed: "x",
        createdAt: Date.now(),
      })
      .run();
    const jobId = queue.enqueue("midi", { songId, source: "master" });
    const job = await waitForJob(jobId);
    expect(job.status).toBe("succeeded");
    const midi = db.select().from(schema.midiTracks).where(eq(schema.midiTracks.songId, songId)).all();
    expect(midi).toHaveLength(1);
    expect(midi[0]?.source).toBe("master");
  });

  it("repaints one section into a child song and keeps the original", async () => {
    const parent = insertParentSong();
    const spy = vi.spyOn(engine, "generate");
    const jobId = queue.enqueue("generate", {
      ...payload({ variations: 1, lyrics: "[verse]\nNeon\n[chorus]\nNew hook" }),
      edit: {
        kind: "repaint",
        parentSongId: parent.id,
        srcAudioPath: parent.abs,
        repaintingStart: 4,
        repaintingEnd: 8,
        sectionLabel: "Chorus",
      },
    });
    const job = await waitForJob(jobId);
    expect(job.status).toBe("succeeded");
    const req = spy.mock.calls[0]![0];
    expect(req.taskType).toBe("repaint");
    expect(req.srcAudioPath).toBe(parent.abs);
    expect(req.repaintingStart).toBe(4);
    expect(req.repaintingEnd).toBe(8);
    expect(req.simpleMode).toBe(false);
    expect(req.batchSize).toBe(1);
    const result = JSON.parse(job.result ?? "{}") as { demoUnchanged?: boolean; message?: string };
    expect(result.demoUnchanged).toBe(true);
    expect(result.message).toBe(DEMO_EDIT_NOTE);
    expect(db.select().from(schema.songs).all()).toHaveLength(1);
  });

  it("extends when the engine reports a longer duration", async () => {
    const parent = insertParentSong();
    const spy = vi.spyOn(engine, "generate");
    const original = engine.getTask.bind(engine);
    engine.getTask = async (taskId) => {
      const status = await original(taskId);
      if (status.state === "succeeded") {
        status.takes = status.takes.map((take) => ({ ...take, durationS: 45 }));
      }
      return status;
    };
    const jobId = queue.enqueue("generate", {
      ...payload({ variations: 1 }),
      durationS: 45,
      edit: {
        kind: "extend",
        parentSongId: parent.id,
        srcAudioPath: parent.abs,
        repaintingStart: 28,
        repaintingEnd: 45,
        targetDurationS: 45,
        sectionLabel: "extended",
      },
    });
    const job = await waitForJob(jobId);
    expect(job.status).toBe("succeeded");
    const req = spy.mock.calls[0]![0];
    expect(req.taskType).toBe("complete");
    expect(req.ditModel).toBe("acestep-v15-base");
    expect(req.thinking).toBe(false);
    expect(req.inferenceSteps).toBe(50);
    expect(engine.ditLoads).toEqual(["acestep-v15-base", "acestep-v15-turbo"]);
    const result = JSON.parse(job.result ?? "{}") as { songIds: string[] };
    const child = db.select().from(schema.songs).where(eq(schema.songs.id, result.songIds[0]!)).get()!;
    expect(child.editKind).toBe("extend");
    expect(child.durationS).toBe(45);
    expect(child.model).toBe("acestep-v15-base");
  });

  it("stores the sample length, not the requested length", async () => {
    const job = await waitForJob(queue.enqueue("generate", payload({ durationS: 120, variations: 1 })));
    expect(job.status).toBe("succeeded");
    const result = JSON.parse(job.result ?? "{}") as { songIds: string[] };
    const song = db.select().from(schema.songs).where(eq(schema.songs.id, result.songIds[0]!)).get()!;
    expect(song.durationS).toBe(DEMO_CLIP_DURATION_S);
  });

  it("does not save a demo extend that did not grow", async () => {
    const parent = insertParentSong();
    const before = db.select().from(schema.songs).all().length;
    const job = await waitForJob(
      queue.enqueue("generate", {
        ...payload({ variations: 1 }),
        durationS: 45,
        edit: {
          kind: "extend",
          parentSongId: parent.id,
          srcAudioPath: parent.abs,
          repaintingStart: 8,
          repaintingEnd: 45,
          targetDurationS: 45,
        },
      }),
    );
    expect(job.status).toBe("succeeded");
    const result = JSON.parse(job.result ?? "{}") as { demoUnchanged?: boolean };
    expect(result.demoUnchanged).toBe(true);
    expect(db.select().from(schema.songs).all()).toHaveLength(before);
  });

  it("merges a repeated click key and keeps a deliberate repeat", () => {
    const body = payload();
    const first = queue.submit("generate", { ...body, idempotencyKey: "click-one-aaaa" });
    const twin = queue.submit("generate", { ...body, idempotencyKey: "click-one-aaaa" });
    expect(twin.merged).toBe(true);
    expect(twin.id).toBe(first.id);
    const again = queue.submit("generate", { ...body, idempotencyKey: "click-two-bbbb" });
    expect(again.merged).toBe(false);
    expect(again.id).not.toBe(first.id);
    const plain = queue.submit("generate", body);
    expect(plain.merged).toBe(false);
    expect(plain.id).not.toBe(again.id);
    expect(db.select().from(schema.jobs).all()).toHaveLength(3);
  });

  it("re-times a song when the click key is new", () => {
    const parent = insertParentSong();
    const first = queue.submit("align", {
      songId: parent.id,
      vocalLanguage: "en",
      idempotencyKey: "align-first-aa",
    });
    const second = queue.submit("align", {
      songId: parent.id,
      vocalLanguage: "en",
      idempotencyKey: "align-second-bb",
    });
    expect(second.merged).toBe(false);
    expect(second.id).not.toBe(first.id);
  });

  it("fails an extend that did not grow, instead of saving the original length", async () => {
    const parent = insertParentSong();
    const original = engine.getTask.bind(engine);
    engine.getTask = async (taskId) => {
      const status = await original(taskId);
      if (status.state === "succeeded") {
        status.takes = status.takes.map((take) => ({ ...take, durationS: 10 }));
      }
      return status;
    };
    const jobId = queue.enqueue("generate", {
      ...payload({ variations: 1 }),
      durationS: 45,
      edit: {
        kind: "extend",
        parentSongId: parent.id,
        srcAudioPath: parent.abs,
        repaintingStart: 28,
        repaintingEnd: 45,
        targetDurationS: 45,
      },
    });
    const job = await waitForJob(jobId);
    expect(job.status).toBe("succeeded");
    const result = JSON.parse(job.result ?? "{}") as { demoUnchanged?: boolean; songIds?: string[] };
    expect(result.demoUnchanged).toBe(true);
    expect(result.songIds ?? []).toHaveLength(0);
    expect(engine.ditLoads).toEqual(["acestep-v15-base", "acestep-v15-turbo"]);
  });

  it("stores demo lyric timings without the aligner", async () => {
    const parent = insertParentSong();
    const job = await waitForJob(queue.enqueue("align", { songId: parent.id, vocalLanguage: "en" }));
    expect(job.status).toBe("succeeded");
    const row = db.select().from(schema.songs).where(eq(schema.songs.id, parent.id)).get()!;
    expect(row.lrc).toMatch(/\[\d{2}:\d{2}\.\d{2}\]/);
    const timings = JSON.parse(row.lyricTimings ?? "{}") as { source: string; lines: unknown[] };
    expect(timings.source).toBe("mock");
    expect(timings.lines.length).toBe(2);
  });
});

describe("queue helpers", () => {
  it("expandSeeds: explicit seed gives seed+i per take (reproducible sets)", () => {
    expect(expandSeeds(42, 3)).toEqual([42, 43, 44]);
  });
  it("expandSeeds: no seed gives distinct random 32-bit ints", () => {
    const seeds = expandSeeds(undefined, 4);
    expect(seeds).toHaveLength(4);
    for (const s of seeds) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
  it("deriveTitle caps length and numbers takes", () => {
    expect(deriveTitle("lo-fi beat", 0, 1)).toBe("Lo-fi beat");
    expect(deriveTitle("lo-fi beat", 1, 2)).toBe("Lo-fi beat (take 2)");
    const long = deriveTitle("a".repeat(100), 0, 1);
    expect(long.length).toBeLessThanOrEqual(60);
  });
  it("deriveTags splits on commas, lowercases, caps at 6", () => {
    expect(deriveTags("Epic Orchestral, Trailer, cinematic")).toEqual([
      "epic orchestral",
      "trailer",
      "cinematic",
    ]);
    expect(deriveTags(Array.from({ length: 10 }, (_, i) => `tag${i}`).join(", "))).toHaveLength(6);
  });
  it("artSeedFor is deterministic (spec §9.4: same seed ⇒ identical art)", () => {
    const a = artSeedFor("id1", "Title", '["tag"]');
    expect(a).toBe(artSeedFor("id1", "Title", '["tag"]'));
    expect(a).not.toBe(artSeedFor("id2", "Title", '["tag"]'));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});
