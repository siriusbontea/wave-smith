/**
 * lib/phone/peer-stamp.ts — record the real TCP peer before any handler runs.
 *
 * Next copies a client-supplied X-Forwarded-For when one is present, so that
 * header is not the peer. X-Real-IP is the same kind of hint. This overwrites
 * a private header from the socket and drops the client address headers.
 * Loaded from next.config so the patch is in place before the server listens.
 */
import http from "node:http";
import { PEER_HEADER, VIA_PROXY_HEADER } from "./headers";
import { isLoopbackHost, normalizeIp } from "./loopback";

const STAMPED = Symbol.for("wavesmith.peerStamped");
const ORIGINAL_FORWARDED_FOR = Symbol.for("wavesmith.originalForwardedFor");
const INSTALLED = Symbol.for("wavesmith.peerStampInstalled");

type StampedMessage = http.IncomingMessage & {
  [STAMPED]?: boolean;
  [ORIGINAL_FORWARDED_FOR]?: string;
};

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function stampPeer(req: http.IncomingMessage): void {
  const marked = req as StampedMessage;
  if (marked[STAMPED]) return;
  marked[STAMPED] = true;
  const peer = req.socket?.remoteAddress ?? "";
  const forwarded = headerValue(req.headers["x-forwarded-for"]);
  marked[ORIGINAL_FORWARDED_FOR] = forwarded ?? "";
  const tailscaleUser =
    headerValue(req.headers["tailscale-user-login"]) || headerValue(req.headers["tailscale-user-name"]);
  // X-Real-IP alone is the same signal as a forged X-Forwarded-For: the
  // header names some other address than the socket, so this is not the Mac.
  const proxyIndicated =
    differsFromPeer(forwarded, peer) ||
    differsFromPeer(headerValue(req.headers["x-real-ip"]), peer);
  if (tailscaleUser || proxyIndicated || headerValue(req.headers.forwarded)) {
    req.headers[VIA_PROXY_HEADER] = "1";
  } else {
    delete req.headers[VIA_PROXY_HEADER];
  }
  delete req.headers["x-real-ip"];
  req.headers[PEER_HEADER] = peer;
  req.headers["x-forwarded-for"] = peer;
}

function differsFromPeer(value: string | undefined, peer: string): boolean {
  const first = value?.split(",")[0]?.trim() ?? "";
  return first.length > 0 && normalizeIp(first) !== normalizeIp(peer);
}

export function installPeerStamp(): void {
  const proto = http.Server.prototype as typeof http.Server.prototype & { [INSTALLED]?: boolean };
  if (proto[INSTALLED]) return;
  proto[INSTALLED] = true;
  const original = http.Server.prototype.emit;
  http.Server.prototype.emit = function (this: http.Server, event: string, ...args: unknown[]) {
    if ((event === "request" || event === "upgrade") && args[0] && typeof args[0] === "object") {
      stampPeer(args[0] as http.IncomingMessage);
    }
    return original.apply(this, [event, ...args] as never);
  } as typeof http.Server.prototype.emit;
}

export function peerIsLoopback(peer: string | null | undefined): boolean {
  if (!peer) return false;
  return isLoopbackHost(normalizeIp(peer));
}
