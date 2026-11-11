/**
 * lib/phone/bind.ts — where the phone door listens.
 *
 * The default is the Mac's Tailscale address only. Home Wi-Fi is a separate
 * choice for this run of the app. A restart clears that choice so "on" does
 * not follow the laptop onto a café network.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import { isLoopbackHost, normalizeIp } from "@/lib/phone/loopback";

export interface BindPlan {
  listen: boolean;
  host: string | null;
  mode: "off" | "tailscale" | "lan";
  reason: string | null;
}

const lanState = { on: false };

/** Home Wi-Fi mode. Memory only — a new process starts with this off. */
export function lanOptIn(): boolean {
  return lanState.on;
}

export function setLanOptIn(on: boolean): void {
  lanState.on = on;
}

/** Called once per process so a saved "on" cannot reopen Wi-Fi after a reboot. */
export function beginPhoneProcess(): void {
  lanState.on = false;
}

export function isTailscaleIPv4(address: string): boolean {
  const match = /^100\.(\d+)\.\d+\.\d+$/.exec(normalizeIp(address));
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 64 && second <= 127;
}

export function isTailscaleIPv6(address: string): boolean {
  const ip = normalizeIp(address);
  return ip === "fd7a:115c:a1e0::" || ip.startsWith("fd7a:115c:a1e0:");
}

export function selectTailscaleAddress(addresses: string[]): string | null {
  const v4 = addresses.map(normalizeIp).find((ip) => isTailscaleIPv4(ip));
  if (v4) return v4;
  const v6 = addresses.map(normalizeIp).find((ip) => isTailscaleIPv6(ip));
  return v6 ?? null;
}

export function planPhoneBind(input: {
  enabled: boolean;
  lan: boolean;
  tailscale: string[];
}): BindPlan {
  if (!input.enabled) {
    return { listen: false, host: null, mode: "off", reason: null };
  }
  if (input.lan) {
    return { listen: true, host: "0.0.0.0", mode: "lan", reason: null };
  }
  const tailscale = selectTailscaleAddress(input.tailscale);
  if (!tailscale) {
    return {
      listen: false,
      host: null,
      mode: "tailscale",
      reason:
        "Tailscale isn't running on this computer, so the phone door stayed closed. Open the Tailscale app and sign in, then turn phone access off and on.",
    };
  }
  return { listen: true, host: tailscale, mode: "tailscale", reason: null };
}

function interfaceAddresses(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || isLoopbackHost(entry.address)) continue;
      found.push(entry.address.split("%")[0] ?? entry.address);
    }
  }
  return found;
}

function tailscaleCommandAddresses(): string[] {
  try {
    const out = execFileSync("tailscale", ["ip"], {
      timeout: 1500,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

let tailscaleCache: { at: number; ips: string[] } | null = null;

/** Tailscale addresses that are actually on this computer. Cached for a few seconds. */
export function localTailscaleAddresses(): string[] {
  if (tailscaleCache && Date.now() - tailscaleCache.at < 5000) return tailscaleCache.ips;
  const local = new Set(interfaceAddresses().map(normalizeIp));
  const fromCommand = tailscaleCommandAddresses().map(normalizeIp).filter((ip) => local.has(ip));
  const fromInterfaces = interfaceAddresses().filter((ip) => isTailscaleIPv4(ip) || isTailscaleIPv6(ip));
  const ips = [...new Set([...fromCommand, ...fromInterfaces.map(normalizeIp)])];
  tailscaleCache = { at: Date.now(), ips };
  return ips;
}

export interface NamedAddress {
  name: string;
  address: string;
}

export function lanDisplayAddresses(entries: NamedAddress[]): string[] {
  const ranked = entries
    .filter((entry) => !entry.address.includes(":"))
    .filter((entry) => !isLoopbackHost(entry.address))
    .map((entry) => {
      const address = normalizeIp(entry.address);
      let rank = 50;
      if (address.startsWith("192.168.")) rank = 0;
      else if (address.startsWith("10.")) rank = 1;
      else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) rank = 2;
      else if (isTailscaleIPv4(address)) rank = 3;
      if (/bridge|docker|veth|vmnet/i.test(entry.name)) rank += 10;
      return { address, rank };
    });
  ranked.sort((a, b) => a.rank - b.rank || a.address.localeCompare(b.address));
  return [...new Set(ranked.map((entry) => entry.address))];
}

export function localLanAddresses(): string[] {
  const entries: NamedAddress[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const entry of list ?? []) {
      const family = entry.family as string | number;
      if (entry.internal || (family !== "IPv4" && family !== 4)) continue;
      entries.push({ name, address: entry.address });
    }
  }
  return lanDisplayAddresses(entries);
}
