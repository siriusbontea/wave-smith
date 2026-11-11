/**
 * lib/phone/gateway.ts — LAN door in front of the local app.
 *
 * The Next server, ACE-Step, and Ollama keep listening on 127.0.0.1. This
 * process opens 0.0.0.0 only while phone access is on, and only after a
 * one-time pairing code. It proxies to the app port and nowhere else, so a
 * phone cannot open the engine port even if it can reach this one.
 */
import http from "node:http";
import { assertLoopbackBaseUrl } from "@/lib/phone/loopback";
import {
  deviceCookie,
  deviceLabel,
  PHONE_COOKIE,
  readCookie,
} from "@/lib/phone/codes";
import { PHONE_CLIENT_HEADER } from "@/lib/phone/client";
import {
  deviceForToken,
  phoneAccessEnabled,
  redeemInvite,
  touchDevice,
} from "@/lib/phone/store";
import { env } from "@/lib/env";

const globalForGateway = globalThis as unknown as {
  __wavesmithPhone?: {
    server: http.Server | null;
    port: number;
    error: string | null;
  };
};

const failures = new Map<string, { count: number; resetAt: number }>();
const FAIL_LIMIT = 8;
const FAIL_WINDOW_MS = 10 * 60_000;

export function phoneListenPort(): number {
  const raw = process.env.PHONE_PORT || "8787";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PHONE_PORT is not a valid port.");
  }
  return port;
}

export function appListenPort(): number {
  const raw = process.env.PORT || "3000";
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : 3000;
}

/** Production bind. Tests pass 127.0.0.1 explicitly so they don't need every interface. */
export function phoneBindHost(): "0.0.0.0" {
  return "0.0.0.0";
}

export function phoneGatewayError(): string | null {
  return globalForGateway.__wavesmithPhone?.error ?? null;
}

export function phoneGatewayListening(): boolean {
  return globalForGateway.__wavesmithPhone?.server?.listening === true;
}

export function stopPhoneGateway(): void {
  const current = globalForGateway.__wavesmithPhone;
  if (!current) return;
  current.server?.close();
  globalForGateway.__wavesmithPhone = undefined;
}

export interface GatewayOptions {
  host: string;
  port: number;
  upstreamPort: number;
}

/** Start a gateway. Resolves with the server, which the caller must close. */
const RESERVED_PORTS = new Set([8001, 11434]);

export function startPhoneGateway(opts: GatewayOptions): Promise<http.Server> {
  assertLoopbackBaseUrl(`http://127.0.0.1:${opts.upstreamPort}`, "app");
  assertLoopbackBaseUrl(env.ENGINE_URL, "ENGINE_URL");
  assertLoopbackBaseUrl(env.LYRICS_LLM_URL, "LYRICS_LLM_URL");
  if (RESERVED_PORTS.has(opts.upstreamPort) || RESERVED_PORTS.has(opts.port)) {
    throw new Error("Phone access cannot use the music engine port or the lyrics port.");
  }
  if (opts.port === opts.upstreamPort) {
    throw new Error("Phone access cannot use the same port as Wavesmith.");
  }
  const server = http.createServer((req, res) => {
    handleGatewayRequest(req, res, opts.upstreamPort);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

/** Open or close the LAN listener to match the saved setting. */
export async function syncPhoneGateway(): Promise<void> {
  if (!phoneAccessEnabled()) {
    stopPhoneGateway();
    return;
  }
  if (phoneGatewayListening()) return;
  const port = phoneListenPort();
  try {
    const server = await startPhoneGateway({
      host: phoneBindHost(),
      port,
      upstreamPort: appListenPort(),
    });
    globalForGateway.__wavesmithPhone = { server, port, error: null };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Could not open phone access.";
    const message = raw.includes("EADDRINUSE")
      ? `Port ${port} is already in use. Close the other program, or set PHONE_PORT.`
      : raw;
    globalForGateway.__wavesmithPhone = { server: null, port, error: message };
  }
}

function clientAddress(req: http.IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

function tooManyFailures(address: string): boolean {
  const now = Date.now();
  const row = failures.get(address);
  if (!row || now > row.resetAt) return false;
  return row.count >= FAIL_LIMIT;
}

function noteFailure(address: string): void {
  const now = Date.now();
  const row = failures.get(address);
  if (!row || now > row.resetAt) {
    failures.set(address, { count: 1, resetAt: now + FAIL_WINDOW_MS });
    return;
  }
  row.count += 1;
}

function handleGatewayRequest(req: http.IncomingMessage, res: http.ServerResponse, upstreamPort: number): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/pair") {
    void handlePair(req, res, url);
    return;
  }
  const token = readCookie(req.headers.cookie, PHONE_COOKIE);
  if (!deviceForToken(token)) {
    if (req.method === "GET") {
      sendHtml(res, 200, pairPage(null));
      return;
    }
    sendJson(res, 401, { error: "This phone is not paired. Scan the code on the computer." });
    return;
  }
  touchDevice(token);
  proxyToApp(req, res, upstreamPort);
}

async function handlePair(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const address = clientAddress(req);
  if (tooManyFailures(address)) {
    sendHtml(res, 429, pairPage("Too many tries. Wait a few minutes and scan a new code."));
    return;
  }
  let code = url.searchParams.get("code") ?? "";
  if (req.method === "POST") code = (await readFormCode(req)) ?? code;
  if (!code.trim()) {
    sendHtml(res, 200, pairPage(null));
    return;
  }
  const redeemed = redeemInvite(code, deviceLabel(req.headers["user-agent"]));
  if (!redeemed) {
    noteFailure(address);
    sendHtml(res, 403, pairPage("That code doesn't match. On the computer, check the code and try again."));
    return;
  }
  res.writeHead(302, {
    Location: "/",
    "Set-Cookie": deviceCookie(redeemed.token),
    "Cache-Control": "no-store",
  });
  res.end();
}

function readFormCode(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2048) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      resolve(params.get("code"));
    });
    req.on("error", () => resolve(null));
  });
}

function proxyToApp(req: http.IncomingMessage, res: http.ServerResponse, upstreamPort: number): void {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  delete headers.connection;
  delete headers[PHONE_CLIENT_HEADER];
  if (typeof headers.cookie === "string") {
    headers.cookie = headers.cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith(`${PHONE_COOKIE}=`))
      .join("; ");
  }
  headers[PHONE_CLIENT_HEADER] = "phone";
  headers.host = `127.0.0.1:${upstreamPort}`;
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers,
    },
    (up) => {
      const out: http.OutgoingHttpHeaders = { ...up.headers };
      delete out["transfer-encoding"];
      delete out.connection;
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (res.headersSent) {
      res.end();
      return;
    }
    sendText(res, 502, "Wavesmith isn't answering on this computer.");
  });
  req.pipe(upstream);
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function pairPage(message: string | null): string {
  const note = message ? `<p class="warn">${escapeHtml(message)}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pair Wavesmith</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #1c1917; color: #fafaf9; margin: 0; padding: 2rem 1.25rem; }
    main { max-width: 24rem; margin: 0 auto; }
    h1 { font-size: 1.4rem; }
    p { line-height: 1.45; }
    .warn { color: #fecaca; }
    label { display: block; margin-top: 1rem; font-size: 0.9rem; }
    input { width: 100%; box-sizing: border-box; margin-top: 0.35rem; padding: 0.7rem; font-size: 1.1rem; letter-spacing: 0.08em; border-radius: 0.6rem; border: 1px solid #44403c; background: #292524; color: inherit; }
    button { margin-top: 0.8rem; padding: 0.7rem 1rem; font-size: 1rem; border: 0; border-radius: 999px; background: #f5d0a9; color: #1c1917; font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <h1>Pair this phone</h1>
    <p>Wavesmith is running on a computer on this Wi-Fi. Ask the person there to show you the pairing code, then type it here.</p>
    ${note}
    <form method="post" action="/pair">
      <label>Pairing code
        <input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" required>
      </label>
      <button type="submit">Pair</button>
    </form>
  </main>
</body>
</html>`;
}
