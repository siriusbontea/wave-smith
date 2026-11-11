/**
 * lib/phone/loopback.ts — backends stay on this computer.
 *
 * ACE-Step and Ollama have no pairing of their own. If either URL pointed at
 * another machine, a paired phone could reach that machine through Wavesmith,
 * or a mis-set env could send prompts off this computer. Both must be loopback.
 */

/** Strip brackets, a zone id, and an IPv4-mapped IPv6 prefix. */
export function normalizeIp(value: string): string {
  let host = value.trim().toLowerCase();
  if (host.startsWith("[") && host.includes("]")) host = host.slice(1, host.indexOf("]"));
  const zone = host.indexOf("%");
  if (zone !== -1) host = host.slice(0, zone);
  if (host.startsWith("::ffff:")) host = host.slice("::ffff:".length);
  return host;
}

export function isLoopbackHost(hostname: string): boolean {
  const host = normalizeIp(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function assertLoopbackBaseUrl(url: string, name: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name} is not a URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must be an http URL on this computer.`);
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `${name} must stay on this computer (${parsed.hostname} is not local). ` +
        "The phone reaches music only through Wavesmith.",
    );
  }
}
