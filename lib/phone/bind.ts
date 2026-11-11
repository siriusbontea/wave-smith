/**
 * lib/phone/bind.ts — where the phone door listens.
 *
 * The default is the Mac's Tailscale address only. Home Wi-Fi is a separate
 * choice for this run of the app. A restart clears that choice so "on" does
 * not follow the laptop onto a café network.
 */
import { execFile } from "node:child_process";
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
        "Tailscale isn't running on this computer, so the phone door stayed closed. Open the Tailscale app and sign in. This page checks again on its own.",
    };
  }
  return { listen: true, host: tailscale, mode: "tailscale", reason: null };
}

export interface NamedInterface {
  name: string;
  address: string;
}

const TAILSCALE_BINS = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];

function namedInterfaces(): NamedInterface[] {
  const found: NamedInterface[] = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || isLoopbackHost(entry.address)) continue;
      found.push({ name, address: entry.address.split("%")[0] ?? entry.address });
    }
  }
  return found;
}

const TAILSCALE_TIMEOUT_MS = 2_000;
const TAILSCALE_CACHE_MS = 30_000;

type TailscaleFlag = "-4" | "-6";
type TailscaleRunner = (bin: string, flag: TailscaleFlag) => Promise<string>;

function defaultTailscaleRunner(bin: string, flag: TailscaleFlag): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      bin,
      ["ip", flag],
      { timeout: TAILSCALE_TIMEOUT_MS, encoding: "utf8" },
      (err, stdout) => {
        if (err || typeof stdout !== "string") resolve("");
        else resolve(stdout);
      },
    );
  });
}

let tailscaleRunner: TailscaleRunner = defaultTailscaleRunner;
let tailscaleCache: { at: number; ips: string[] } | null = null;
let tailscaleInflight: Promise<string[]> | null = null;

/** Tests replace the CLI. Production keeps execFile, which does not block the event loop. */
export function setTailscaleRunnerForTests(next: TailscaleRunner | null): void {
  tailscaleRunner = next ?? defaultTailscaleRunner;
  tailscaleCache = null;
  tailscaleInflight = null;
}

async function tailscaleCommandAddresses(): Promise<string[]> {
  const flags: TailscaleFlag[] = ["-4", "-6"];
  const outputs = await Promise.all(
    TAILSCALE_BINS.flatMap((bin) =>
      flags.map(async (flag) => {
        try {
          return await tailscaleRunner(bin, flag);
        } catch {
          // Timeout, missing binary, or signed out. An empty result keeps the door closed.
          return "";
        }
      }),
    ),
  );
  return outputs.flatMap((out) => out.split(/\s+/).filter(Boolean));
}

function inTailscaleRange(address: string): boolean {
  return isTailscaleIPv4(address) || isTailscaleIPv6(address);
}

/**
 * Addresses Tailscale itself reports. A 100.64.0.0/10 address on Wi-Fi or
 * another VPN is not enough. The CLI (`tailscale ip`, including the macOS
 * app) must list it, or it must sit on an interface named tailscale0.
 */
export function confirmedTailscaleAddresses(input: {
  reported: string[];
  interfaces: NamedInterface[];
}): string[] {
  const local = input.interfaces.map((entry) => ({
    name: entry.name,
    address: normalizeIp(entry.address),
  }));
  const localSet = new Set(local.map((entry) => entry.address));
  const fromCli = input.reported
    .map(normalizeIp)
    .filter((ip) => localSet.has(ip) && inTailscaleRange(ip));
  const fromDevice = local
    .filter((entry) => /^tailscale\d*$/i.test(entry.name))
    .map((entry) => entry.address)
    .filter(inTailscaleRange);
  return [...new Set([...fromCli, ...fromDevice])];
}

/**
 * Tailscale addresses that are actually on this computer.
 * The CLI is async and cached for 30 seconds so a request is not stuck behind it.
 * `refresh` is for Check again. A timeout or a missing CLI yields no address,
 * and the door stays closed.
 */
export async function localTailscaleAddresses(options?: { refresh?: boolean }): Promise<string[]> {
  const cached = tailscaleCache;
  if (!options?.refresh && cached && Date.now() - cached.at < TAILSCALE_CACHE_MS) return cached.ips;
  if (tailscaleInflight) return tailscaleInflight;
  const run = (async () => {
    const ips = confirmedTailscaleAddresses({
      reported: await tailscaleCommandAddresses(),
      interfaces: namedInterfaces(),
    });
    tailscaleCache = { at: Date.now(), ips };
    return ips;
  })().finally(() => {
    if (tailscaleInflight === run) tailscaleInflight = null;
  });
  tailscaleInflight = run;
  return run;
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
