/**
 * lib/audio/zip.ts — assemble stem WAVs into a downloadable ZIP (spec §7).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ZipEntry {
  /** Filename inside the archive. */
  name: string;
  abs: string;
}

export function createStemsZip(entries: ZipEntry[], destZip: string): Promise<void> {
  fs.mkdirSync(path.dirname(destZip), { recursive: true });
  const tmp = `${destZip}.part-${process.pid}`;
  fs.rmSync(tmp, { force: true });

  return new Promise((resolve, reject) => {
    // zip -j drops directory paths; entries are flat stem names.
    const args = ["-j", tmp, ...entries.flatMap((e) => [e.abs])];
    const proc = spawn("zip", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err) =>
      reject(new Error(`zip not available: ${err.message}`)),
    );
    proc.on("close", (code) => {
      if (code !== 0) {
        fs.rmSync(tmp, { force: true });
        reject(new Error(`zip exited ${code}: ${stderr.slice(-300)}`));
        return;
      }
      fs.renameSync(tmp, destZip);
      resolve();
    });
  });
}
