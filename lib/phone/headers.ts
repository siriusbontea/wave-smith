/**
 * lib/phone/headers.ts — header names shared by the browser and the server.
 * No Node builtins here, so client components can import it.
 */

/** Set by the gateway. A browser that guesses it is rejected, not treated as the Mac. */
export const GATEWAY_SECRET_HEADER = "x-wavesmith-gateway";

/** Stamped from the TCP peer. Client-supplied values are overwritten. */
export const PEER_HEADER = "x-wavesmith-peer";

/** Set when the request arrived through a proxy (Tailscale Serve, a forwarder). */
export const VIA_PROXY_HEADER = "x-wavesmith-via-proxy";

/**
 * Custom header on state-changing fetches. A plain form or text/plain POST
 * cannot set it, so a page on another site cannot click Turn on for you.
 */
export const WAVESMITH_REQUEST_HEADER = "x-wavesmith-request";

/** Set only by the gateway's own health check. A phone request never carries it. */
export const INSTANCE_PROBE_HEADER = "x-wavesmith-probe";
