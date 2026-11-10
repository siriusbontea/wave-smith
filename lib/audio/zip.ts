/**
 * lib/audio/zip.ts — assemble stem files into a downloadable ZIP.
 *
 * Stored (uncompressed) entries, written in process. No `zip` binary, so a
 * Linux box without that command can still download stems.
 */
import { crc32 } from "node:zlib";
import fs from "node:fs";
import path from "node:path";

export interface ZipEntry {
  /** Filename inside the archive. */
  name: string;
  abs: string;
}

function u16(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

function u32(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n >>> 0);
  return buf;
}

export async function createStemsZip(entries: ZipEntry[], destZip: string): Promise<void> {
  fs.mkdirSync(path.dirname(destZip), { recursive: true });
  const tmp = `${destZip}.part-${process.pid}`;
  fs.rmSync(tmp, { force: true });

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const data = fs.readFileSync(entry.abs);
    const crc = crc32(data) >>> 0;
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBuf.length),
    u32(offset),
    u16(0),
  ]);
  fs.writeFileSync(tmp, Buffer.concat([...locals, centralBuf, eocd]));
  fs.renameSync(tmp, destZip);
}
