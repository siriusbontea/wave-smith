/**
 * lib/phone/peer-stamp.ts — record the real TCP peer before any handler runs.
 *
 * Next copies a client-supplied X-Forwarded-For when one is present, so that
 * header is not the peer. This overwrites a private header from the socket.
 * Loaded from next.config so the patch is in place before the server listens.
 */
import http from "node:http";
import { PEER_HEADER, VIA_PROXY_HEADER } from "./headers";
import { isLoopbackHost, normalizeIp } from "./loopback";

let installed = false;

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function stampPeer(req: http.IncomingMessage): void {
  const peer = req.socket?.remoteAddress ?? "";
  const forwarded = headerValue(req.headers["x-forwarded-for"]);
  const firstForwarded = forwarded?.split(",")[0]?.trim() ?? "";
  const tailscaleUser =
    headerValue(req.headers["tailscale-user-login"]) || headerValue(req.headers["tailscale-user-name"]);
  const forwardedDiffers =
    firstForwarded.length > 0 && normalizeIp(firstForwarded) !== normalizeIp(peer);
  if (tailscaleUser || forwardedDiffers || headerValue(req.headers.forwarded)) {
    req.headers[VIA_PROXY_HEADER] = "1";
  } else {
    delete req.headers[VIA_PROXY_HEADER];
  }
  req.headers[PEER_HEADER] = peer;
  req.headers["x-forwarded-for"] = peer;
}

export function installPeerStamp(): void {
  if (installed) return;
  installed = true;
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
