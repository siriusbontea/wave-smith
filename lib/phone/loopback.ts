/**
 * lib/phone/loopback.ts — backends stay on this computer.
 *
 * ACE-Step and Ollama have no pairing of their own. If either URL pointed at
 * another machine, a paired phone could reach that machine through Wavesmith,
 * or a mis-set env could send prompts off this computer. Both must be loopback.
 */

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
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
