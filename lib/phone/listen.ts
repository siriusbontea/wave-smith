/**
 * lib/phone/listen.ts — prove the Next app is on 127.0.0.1 before opening the phone door.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { isLoopbackHost, normalizeIp } from "@/lib/phone/loopback";

export interface ListenAddr {
  address: string;
  port: number;
}

export function gatewayStartAllowed(
  listens: ListenAddr[] | null,
  port: number,
): { ok: true } | { ok: false; reason: string } {
  if (!listens) {
    return {
      ok: false,
      reason: "Couldn't check that Wavesmith is only on 127.0.0.1, so the phone door stayed closed.",
    };
  }
  const onPort = listens.filter((row) => row.port === port);
  const loopback = onPort.some((row) => isLoopbackHost(row.address));
  const wider = onPort.some((row) => !isLoopbackHost(row.address));
  if (wider || !loopback) {
    return {
      ok: false,
      reason: "Wavesmith must listen only on 127.0.0.1. Phone access stayed off.",
    };
  }
  return { ok: true };
}

function parseProc(text: string): ListenAddr[] {
  const rows: ListenAddr[] = [];
  for (const line of text.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || parts[3] !== "0A") continue;
    const [ipHex, portHex] = (parts[1] ?? "").split(":");
    if (!ipHex || !portHex || ipHex.length !== 8) continue;
    const port = Number.parseInt(portHex, 16);
    const bytes = ipHex.match(/../g);
    if (!bytes) continue;
    const address = bytes
      .reverse()
      .map((b) => String(Number.parseInt(b, 16)))
      .join(".");
    rows.push({ address: address === "0.0.0.0" ? "0.0.0.0" : normalizeIp(address), port });
  }
  return rows;
}

function parseLsof(text: string): ListenAddr[] {
  const rows: ListenAddr[] = [];
  for (const line of text.split("\n")) {
    const match = /TCP\s+(\S+):(\d+)\s+\(LISTEN\)/.exec(line);
    if (!match) continue;
    let address = match[1] ?? "";
    if (address === "*") address = "0.0.0.0";
    rows.push({ address: normalizeIp(address), port: Number(match[2]) });
  }
  return rows;
}

/** Listen sockets for this process. Null when we cannot tell. */
export function detectListens(): ListenAddr[] | null {
  try {
    if (fs.existsSync("/proc/net/tcp")) {
      const mine = new Set<string>();
      const fdDir = `/proc/${process.pid}/fd`;
      for (const fd of fs.readdirSync(fdDir)) {
        try {
          const target = fs.readlinkSync(`${fdDir}/${fd}`);
          const match = /^socket:\[(\d+)\]$/.exec(target);
          if (match?.[1]) mine.add(match[1]);
        } catch {
          // A fd can vanish while we read the directory.
        }
      }
      const rows: ListenAddr[] = [];
      const text = fs.readFileSync("/proc/net/tcp", "utf8");
      for (const line of text.split("\n").slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10 || parts[3] !== "0A") continue;
        if (!mine.has(parts[9] ?? "")) continue;
        rows.push(...parseProc(`sl local rem st\n${line}`));
      }
      return rows;
    }
  } catch {
    return null;
  }
  try {
    const out = execFileSync("lsof", ["-nP", "-a", "-p", String(process.pid), "-iTCP", "-sTCP:LISTEN"], {
      timeout: 1500,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseLsof(out);
  } catch {
    return null;
  }
}
