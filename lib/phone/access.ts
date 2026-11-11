/**
 * lib/phone/access.ts — who is calling, and whether a write is allowed.
 *
 * Mac: the TCP peer is loopback, the Host is loopback, and nothing says a
 * proxy sat in front. Missing those facts is a rejection, not a Mac.
 * Phone: the gateway's per-boot secret matches. A wrong secret is a rejection.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  GATEWAY_SECRET_HEADER,
  PEER_HEADER,
  VIA_PROXY_HEADER,
  WAVESMITH_REQUEST_HEADER,
} from "@/lib/phone/headers";
import { isLoopbackHost, normalizeIp } from "@/lib/phone/loopback";
import { peerIsLoopback } from "@/lib/phone/peer-stamp";
import { gatewaySecret } from "@/lib/phone/secret";

export type ClientKind = "mac" | "phone" | "rejected";

function secretsMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function requestHost(req: Request): string | null {
  const host = req.headers.get("host");
  if (host) return host;
  try {
    return new URL(req.url).host;
  } catch {
    return null;
  }
}

export function classifyRequest(req: Request): ClientKind {
  const provided = req.headers.get(GATEWAY_SECRET_HEADER);
  if (provided) {
    return secretsMatch(provided, gatewaySecret()) ? "phone" : "rejected";
  }
  if (req.headers.get(VIA_PROXY_HEADER) === "1") return "rejected";
  if (req.headers.get("tailscale-user-login") || req.headers.get("tailscale-user-name")) {
    return "rejected";
  }
  const peer = req.headers.get(PEER_HEADER);
  if (!peerIsLoopback(peer)) return "rejected";
  const host = requestHost(req);
  if (!host || !hostIsLoopback(host)) return "rejected";
  return "mac";
}

function hostIsLoopback(host: string): boolean {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end !== -1 && isLoopbackHost(host.slice(1, end));
  }
  return isLoopbackHost(normalizeIp(host.split(":")[0] ?? host));
}

export function isPhoneClient(req: Request): boolean {
  return classifyRequest(req) === "phone";
}

/** Media type only. `application/json; charset=utf-8` matches. `application/jsonx` does not. */
export function isJsonMediaType(contentType: string | null | undefined): boolean {
  const media = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return media === "application/json";
}

function splitHostHeader(hostHeader: string): { host: string; port: string } | null {
  if (hostHeader.startsWith("[")) {
    const end = hostHeader.indexOf("]");
    if (end === -1) return null;
    const rest = hostHeader.slice(end + 1);
    const port = rest.startsWith(":") ? rest.slice(1) : "";
    if (!/^\d+$/.test(port)) return null;
    return { host: hostHeader.slice(1, end), port };
  }
  const colon = hostHeader.lastIndexOf(":");
  if (colon === -1) return null;
  const port = hostHeader.slice(colon + 1);
  if (!/^\d+$/.test(port)) return null;
  return { host: hostHeader.slice(0, colon), port };
}

/** Scheme, hostname, and port. A different port is a different origin. */
export function originMatchesHost(origin: string | null, hostHeader: string | null): boolean {
  if (!origin || !hostHeader) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const expected = splitHostHeader(hostHeader);
  if (!expected) return false;
  const originPort = url.port || (url.protocol === "https:" ? "443" : "80");
  return normalizeIp(url.hostname) === normalizeIp(expected.host) && originPort === expected.port;
}

export function authorizeWrite(req: Request, kind: ClientKind): { ok: true } | { ok: false; status: number; error: string } {
  if (kind === "rejected") {
    return {
      ok: false,
      status: 403,
      error: "Open Wavesmith on this computer at 127.0.0.1. A proxy in front of this port is not the Mac.",
    };
  }
  let path = "/";
  try {
    path = new URL(req.url).pathname;
  } catch {
    path = "/";
  }
  // Next's own page requests are not the API. Lock the JSON API only.
  if (!path.startsWith("/api/")) return { ok: true };
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return { ok: true };

  const contentType = req.headers.get("content-type");
  if (method !== "DELETE" && !isJsonMediaType(contentType)) {
    return { ok: false, status: 403, error: "Use the Wavesmith app. This request was refused." };
  }
  if (req.headers.get(WAVESMITH_REQUEST_HEADER) !== "1") {
    return { ok: false, status: 403, error: "Use the Wavesmith app. This request was refused." };
  }
  if (kind === "mac" && !originMatchesHost(req.headers.get("origin"), requestHost(req))) {
    return { ok: false, status: 403, error: "Use the Wavesmith app on this computer." };
  }
  return { ok: true };
}

export function rejectedResponse(kind: ClientKind): NextResponse | null {
  if (kind !== "rejected") return null;
  return NextResponse.json(
    { error: "Open Wavesmith on this computer at 127.0.0.1." },
    { status: 403 },
  );
}
