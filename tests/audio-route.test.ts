/**
 * /api/audio Range-support tests — 206 is an explicit M2 verification gate
 * (spec §9.6: seeking depends on it), plus traversal protection.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/audio/[...path]/route";
import { env } from "@/lib/env";

const FILE_BYTES = Buffer.from("RIFF....WAVEfmt wavesmith-test-audio-payload-0123456789");

function call(relPath: string[], headers: Record<string, string> = {}) {
  const req = new Request(`http://localhost/api/audio/${relPath.join("/")}`, { headers });
  return GET(req, { params: Promise.resolve({ path: relPath }) });
}

beforeAll(() => {
  const dir = path.join(env.audioDir, "song-1");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "take.wav"), FILE_BYTES);
});

describe("GET /api/audio (Range support)", () => {
  it("serves the whole file with 200 + Accept-Ranges when no Range is sent", async () => {
    const res = await call(["song-1", "take.wav"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Type")).toBe("audio/wav");
    expect(Number(res.headers.get("Content-Length"))).toBe(FILE_BYTES.length);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(FILE_BYTES)).toBe(true);
  });

  it("returns 206 with the requested byte window (THE gate check)", async () => {
    const res = await call(["song-1", "take.wav"], { range: "bytes=4-9" });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 4-9/${FILE_BYTES.length}`);
    expect(Number(res.headers.get("Content-Length"))).toBe(6);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(FILE_BYTES.subarray(4, 10))).toBe(true);
  });

  it("handles open-ended ranges (bytes=N-)", async () => {
    const res = await call(["song-1", "take.wav"], { range: "bytes=10-" });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(
      `bytes 10-${FILE_BYTES.length - 1}/${FILE_BYTES.length}`,
    );
  });

  it("handles suffix ranges (bytes=-N)", async () => {
    const res = await call(["song-1", "take.wav"], { range: "bytes=-5" });
    expect(res.status).toBe(206);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(FILE_BYTES.subarray(FILE_BYTES.length - 5))).toBe(true);
  });

  it("clamps end beyond EOF to the file size", async () => {
    const res = await call(["song-1", "take.wav"], { range: "bytes=0-999999" });
    expect(res.status).toBe(206);
    expect(Number(res.headers.get("Content-Length"))).toBe(FILE_BYTES.length);
  });

  it("416s unsatisfiable and malformed byte ranges with Content-Range */size", async () => {
    for (const bad of ["bytes=999999-", "bytes=-0", "bytes=-"]) {
      const res = await call(["song-1", "take.wav"], { range: bad });
      expect(res.status, `range header: ${bad}`).toBe(416);
      expect(res.headers.get("Content-Range")).toBe(`bytes */${FILE_BYTES.length}`);
    }
  });

  it("ignores unknown range units and multi-ranges per RFC 9110 (200, full body)", async () => {
    for (const ignored of ["characters=0-5", "bytes=0-5, 10-15"]) {
      const res = await call(["song-1", "take.wav"], { range: ignored });
      expect(res.status, `range header: ${ignored}`).toBe(200);
      expect(Number(res.headers.get("Content-Length"))).toBe(FILE_BYTES.length);
    }
  });

  it("blocks path traversal", async () => {
    const res = await call(["..", "..", "wavesmith.db"]);
    expect([400, 404]).toContain(res.status);
    // And the URL-encoded variant:
    const res2 = await call(["%2e%2e", "secrets"]);
    expect([400, 404]).toContain(res2.status);
  });

  it("404s missing files without leaking paths", async () => {
    const res = await call(["song-1", "nope.wav"]);
    expect(res.status).toBe(404);
  });
});
