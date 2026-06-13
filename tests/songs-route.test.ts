/**
 * Song API route tests — list, get, patch, delete, stems enqueue.
 */
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as songsGET } from "@/app/api/songs/route";
import { GET as songGET, PATCH as songPATCH, DELETE as songDELETE } from "@/app/api/songs/[id]/route";
import { POST as stemsPOST } from "@/app/api/songs/[id]/stems/route";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

const SONG_ID = "test-song-api-001";

beforeAll(() => {
  const rel = path.join(SONG_ID, "take.mp3");
  const abs = path.join(env.audioDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.copyFileSync(path.resolve("public/demo-clip.mp3"), abs);
  db.insert(schema.songs)
    .values({
      id: SONG_ID,
      title: "API Test Song",
      prompt: "test prompt",
      lyrics: "[verse]\nLine",
      tags: JSON.stringify(["test"]),
      model: "mock",
      variationGroupId: SONG_ID,
      audioPath: rel,
      artSeed: "abc",
      createdAt: Date.now(),
    })
    .run();
});

describe("GET /api/songs", () => {
  it("lists songs newest-first with parsed tags", async () => {
    const res = await songsGET();
    expect(res.status).toBe(200);
    const { songs } = (await res.json()) as { songs: Array<{ id: string; tags: string[] }> };
    const hit = songs.find((s) => s.id === SONG_ID);
    expect(hit?.tags).toEqual(["test"]);
  });
});

describe("GET /api/songs/[id]", () => {
  it("returns one song with stems array", async () => {
    const res = await songGET(new Request("http://x"), { params: Promise.resolve({ id: SONG_ID }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; stems: unknown[] };
    expect(body.id).toBe(SONG_ID);
    expect(Array.isArray(body.stems)).toBe(true);
  });
});

describe("PATCH /api/songs/[id]", () => {
  it("updates favorite", async () => {
    const res = await songPATCH(
      new Request("http://x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: true }),
      }),
      { params: Promise.resolve({ id: SONG_ID }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { favorite: boolean };
    expect(body.favorite).toBe(true);
  });
});

describe("POST /api/songs/[id]/stems", () => {
  it("enqueues a stems job", async () => {
    const res = await stemsPOST(new Request("http://x", { method: "POST" }), {
      params: Promise.resolve({ id: SONG_ID }),
    });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
    expect(job?.type).toBe("stems");
  });
});

describe("DELETE /api/songs/[id]", () => {
  it("removes the song row", async () => {
    const res = await songDELETE(new Request("http://x", { method: "DELETE" }), {
      params: Promise.resolve({ id: SONG_ID }),
    });
    expect(res.status).toBe(200);
    expect(db.select().from(schema.songs).where(eq(schema.songs.id, SONG_ID)).get()).toBeUndefined();
  });
});
