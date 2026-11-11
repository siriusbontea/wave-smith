/**
 * cli/ports.ts — read who owns a port.
 * 127.0.0.1 and ::1 are this computer. 0.0.0.0, *, and :: are every network.
 */

export interface Listener {
  address: string;
  port: number;
}

const OPEN = new Set(["0.0.0.0", "*", "::", "::0", "0:0:0:0:0:0:0:0"]);

export function isOpenAddress(address: string): boolean {
  return OPEN.has(address.toLowerCase());
}

export function assessPort(
  port: number,
  addresses: readonly string[],
): { ok: boolean; detail: string; fix?: string } {
  if (addresses.length === 0) {
    return { ok: true, detail: `Nothing is listening on port ${port}.` };
  }
  const open = addresses.filter(isOpenAddress);
  if (open.length > 0) {
    return {
      ok: false,
      detail: `Port ${port} is open on ${open.join(", ")}, which is every network, not only this computer.`,
      fix: "Stop that program. Wavesmith listens on 127.0.0.1 only. Then run: wavesmith start",
    };
  }
  const foreign = addresses.filter((address) => address !== "127.0.0.1" && address !== "::1");
  if (foreign.length > 0) {
    return {
      ok: false,
      detail: `Port ${port} is listening on ${addresses.join(", ")}.`,
      fix: "Stop that program, or choose another PORT in .env, then run: wavesmith start",
    };
  }
  return { ok: true, detail: `Port ${port} is listening on ${addresses.join(", ")}.` };
}

/** /proc/net/tcp and tcp6. State 0A is LISTEN. */
export function parseProcNet(contents: string, family: "v4" | "v6"): Listener[] {
  const rows: Listener[] = [];
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("sl")) continue;
    const parts = trimmed.split(/\s+/);
    const local = parts[1];
    const state = parts[3];
    if (!local || state !== "0A") continue;
    const colon = local.lastIndexOf(":");
    if (colon < 1) continue;
    const ipHex = local.slice(0, colon);
    const portHex = local.slice(colon + 1);
    const port = Number.parseInt(portHex, 16);
    if (!Number.isFinite(port)) continue;
    rows.push({ address: family === "v4" ? hexIpv4(ipHex) : hexIpv6(ipHex), port });
  }
  return rows;
}

function hexIpv4(hex: string): string {
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return hex;
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff].join(".");
}

function hexIpv6(hex: string): string {
  if (/^0+$/.test(hex)) return "::";
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 8) {
    const word = hex.slice(i, i + 8);
    const n = Number.parseInt(word, 16);
    if (!Number.isFinite(n)) return hex;
    bytes.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
  }
  const groups: string[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    const hi = bytes[i] ?? 0;
    const lo = bytes[i + 1] ?? 0;
    groups.push(((hi << 8) | lo).toString(16));
  }
  const joined = groups.join(":");
  if (joined === "0:0:0:0:0:0:0:1") return "::1";
  return joined;
}

export function parseSs(output: string): Listener[] {
  const rows: Listener[] = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== "LISTEN") continue;
    const local = parts[3];
    if (!local) continue;
    const parsed = splitHostPort(local);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

export function parseLsof(output: string): Listener[] {
  const rows: Listener[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/TCP\s+(\S+):(\d+)\s+\(LISTEN\)/);
    const host = match?.[1];
    const portText = match?.[2];
    if (!host || !portText) continue;
    const address = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    const port = Number.parseInt(portText, 10);
    if (Number.isFinite(port)) rows.push({ address, port });
  }
  return rows;
}

function splitHostPort(local: string): Listener | null {
  if (local.startsWith("[")) {
    const end = local.indexOf("]");
    if (end < 0) return null;
    const port = Number.parseInt(local.slice(end + 2), 10);
    if (!Number.isFinite(port)) return null;
    return { address: local.slice(1, end), port };
  }
  const colon = local.lastIndexOf(":");
  if (colon < 1) return null;
  const port = Number.parseInt(local.slice(colon + 1), 10);
  if (!Number.isFinite(port)) return null;
  return { address: local.slice(0, colon), port };
}

export function addressesOnPort(listeners: readonly Listener[], port: number): string[] {
  return listeners.filter((row) => row.port === port).map((row) => row.address);
}
