/**
 * lib/phone/dev-origins.ts — hosts Next may serve dev assets to.
 *
 * `next dev` blocks /_next from any host other than localhost. A paired phone
 * loads the page from the Tailscale or Wi-Fi address, so those ranges have to
 * be named. This is not `*`. Production does not use the list.
 */
function dottedRange(prefix: string, from: number, to: number): string[] {
  const patterns: string[] = [];
  for (let n = from; n <= to; n++) patterns.push(`${prefix}${n}.*.*`);
  return patterns;
}

/** Tailscale 100.64/10, RFC1918, and loopback. Not `*`. */
export const PHONE_DEV_ORIGINS = [
  "127.0.0.1",
  "::1",
  "localhost",
  ...dottedRange("100.", 64, 127),
  "192.168.*.*",
  "10.*.*.*",
  ...dottedRange("172.", 16, 31),
];

function matchPart(domain: string[], pattern: string[]): boolean {
  const d = [...domain];
  const p = [...pattern];
  while (p.length) {
    const pat = p.pop();
    const part = d.pop();
    if (pat === "*") {
      if (!part) return false;
      continue;
    }
    if (part !== pat) return false;
  }
  return d.length === 0;
}

/** Same shape as Next's allowedDevOrigins check, for tests. */
export function devOriginAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const parts = host.split(".");
  return PHONE_DEV_ORIGINS.some((pattern) => {
    if (pattern === host) return true;
    if (!pattern.includes("*")) return false;
    return matchPart(parts, pattern.toLowerCase().split("."));
  });
}
