/**
 * GET /api/audio/<relative path> — serves generated audio from DATA_DIR/audio
 * with HTTP Range support (spec §9.6). Seeking in the player depends on 206
 * responses, and it's an M2 verification gate.
 *
 * Security: the resolved path must stay inside DATA_DIR/audio — traversal
 * (..) and absolute-path tricks return 400/404, never bytes.
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const MEDIA_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  // Next.js delivers catch-all params already percent-decoded — decoding again
  // would throw on legitimate %-containing names and 500.
  const { path: segments } = await ctx.params;
  const relPath = segments.join("/");

  // Resolve and confine to the audio dir (path.resolve normalizes "..");
  // realpath also refuses symlinks that point outside it.
  const absPath = path.resolve(env.audioDir, relPath);
  if (absPath !== env.audioDir && !absPath.startsWith(env.audioDir + path.sep)) {
    return new Response("Invalid path", { status: 400 });
  }
  let realPath: string;
  let stat: fs.Stats;
  try {
    realPath = fs.realpathSync(absPath);
    stat = fs.statSync(realPath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const realAudioDir = fs.realpathSync(env.audioDir);
  if (realPath !== realAudioDir && !realPath.startsWith(realAudioDir + path.sep)) {
    return new Response("Invalid path", { status: 400 });
  }
  if (!stat.isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const mediaType = MEDIA_TYPES[path.extname(absPath).toLowerCase()] ?? "application/octet-stream";
  const rawRange = _req.headers.get("range");
  // RFC 9110: unknown range units (and unsupported multi-range) MUST be
  // ignored — serve the full 200, don't 416.
  const range = rawRange && /^bytes=[^,]+$/.test(rawRange.trim()) ? rawRange.trim() : null;

  if (range) {
    // "bytes=start-end" | "bytes=start-" | "bytes=-suffixLength"
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (m[1] === "" && m[2] === "")) {
      return new Response("Malformed Range", {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    let start: number;
    let end: number;
    if (m[1] === "") {
      // suffix range: last N bytes
      const suffix = Number(m[2]);
      if (suffix === 0) {
        return new Response("Unsatisfiable Range", {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }
      start = Math.max(0, stat.size - suffix);
      end = stat.size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? stat.size - 1 : Math.min(Number(m[2]), stat.size - 1);
    }
    if (start >= stat.size || start > end) {
      return new Response("Unsatisfiable Range", {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    const stream = fs.createReadStream(realPath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": mediaType,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=31536000, immutable", // takes never change
      },
    });
  }

  const stream = fs.createReadStream(realPath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": mediaType,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
