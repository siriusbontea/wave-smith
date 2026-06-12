/**
 * Route-handler tests (direct invocation, MOCK_ENGINE=1, no servers):
 * the /api/generate zod boundary, the /api/jobs shape M3's queue strip binds
 * to, and /api/health under the mock seam.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as generatePOST } from "@/app/api/generate/route";
import { GET as jobsGET } from "@/app/api/jobs/route";
import { GET as healthGET } from "@/app/api/health/route";
import { db, schema } from "@/lib/db";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForJobRow(jobId: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
    if (job && (job.status === "succeeded" || job.status === "failed")) return job;
    if (Date.now() > deadline) throw new Error("job did not finish");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("POST /api/generate", () => {
  it("accepts a valid forge: 202 + jobId, defaults variations to 2", async () => {
    const res = await generatePOST(jsonRequest({ prompt: "test song" }));
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    expect(jobId).toMatch(/[0-9a-f-]{36}/);
    const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get()!;
    const payload = JSON.parse(job.payload) as { variations: number; instrumental: boolean };
    expect(payload.variations).toBe(2); // spec §9.2 default
    expect(payload.instrumental).toBe(false);
    const finished = await waitForJobRow(jobId);
    expect(finished.status).toBe("succeeded"); // mock engine end-to-end
  });

  it("rejects unknown fields (strict schema)", async () => {
    const res = await generatePOST(jsonRequest({ prompt: "x", hacky_extra: true }));
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON with 400, not 500", async () => {
    const res = await generatePOST(
      new Request("http://localhost/api/generate", { method: "POST", body: "{not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects out-of-range values", async () => {
    const res = await generatePOST(
      jsonRequest({ prompt: "x", variations: 5, durationS: 5, seed: 2 ** 33 }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: unknown[] };
    expect(body.issues.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects an empty prompt", async () => {
    const res = await generatePOST(jsonRequest({ prompt: "   " }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/jobs", () => {
  it("returns the serialized shape the queue strip binds to", async () => {
    const res = await generatePOST(jsonRequest({ prompt: "for jobs shape", variations: 1 }));
    const { jobId } = (await res.json()) as { jobId: string };
    await waitForJobRow(jobId);

    const jobsRes = await jobsGET();
    expect(jobsRes.status).toBe(200);
    const { jobs } = (await jobsRes.json()) as { jobs: Array<Record<string, unknown>> };
    const job = jobs.find((j) => j.id === jobId)!;
    expect(job).toMatchObject({ type: "generate", status: "succeeded", progress: 1 });
    expect(job).toHaveProperty("stage");
    expect(job).toHaveProperty("error");
    const result = job.result as { songIds: string[]; variationGroupId: string };
    expect(result.songIds).toHaveLength(1);
  });

  it("survives a corrupt result row (returns null result, not a 500)", async () => {
    db.insert(schema.jobs)
      .values({
        id: "corrupt-1",
        type: "generate",
        status: "succeeded",
        payload: "{}",
        result: "{definitely not json",
        createdAt: Date.now(),
      })
      .run();
    const res = await jobsGET();
    expect(res.status).toBe(200);
    const { jobs } = (await res.json()) as { jobs: Array<{ id: string; result: unknown }> };
    expect(jobs.find((j) => j.id === "corrupt-1")!.result).toBeNull();
  });
});

describe("GET /api/health", () => {
  it("reports mock engine ready + db ok + lyrics available under MOCK_ENGINE=1", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      db: string;
      mockEngine: boolean;
      engine: { state: string };
      lyrics: { available: boolean };
    };
    expect(body.db).toBe("ok");
    expect(body.mockEngine).toBe(true);
    expect(body.engine.state).toBe("ready");
    expect(body.lyrics.available).toBe(true); // MockLyricsClient
  });
});
