/**
 * lib/phone/gateway.ts — the phone door in front of the local app.
 *
 * Next, ACE-Step, and Ollama stay on 127.0.0.1. This listener opens only while
 * phone access is on, and only on the Tailscale address unless home Wi-Fi was
 * turned on for this run. It proxies to the app after pairing and nowhere else.
 */
import http from "node:http";
import { isJsonMediaType, originMatchesHost } from "@/lib/phone/access";
import { GATEWAY_SECRET_HEADER, INSTANCE_PROBE_HEADER, WAVESMITH_REQUEST_HEADER } from "@/lib/phone/headers";
import { assertLoopbackBaseUrl, isLoopbackHost, normalizeIp } from "@/lib/phone/loopback";
import { lanOptIn, localTailscaleAddresses, planPhoneBind, type BindPlan } from "@/lib/phone/bind";
import { deviceCookie, deviceLabel, PHONE_COOKIE, readCookie } from "@/lib/phone/codes";
import { detectListens, gatewayStartAllowed } from "@/lib/phone/listen";
import { gatewaySecret, instanceMark } from "@/lib/phone/secret";
import { env } from "@/lib/env";
import {
  deviceForToken,
  phoneAccessEnabled,
  redeemInvite,
  touchDevice,
} from "@/lib/phone/store";

const globalForGateway = globalThis as unknown as {
  __wavesmithPhone?: {
    server: http.Server | null;
    port: number;
    host: string | null;
    error: string | null;
    mode: BindPlan["mode"];
  };
};

const failures = new Map<string, { count: number; resetAt: number }>();
const FAIL_WINDOW_MS = 60_000;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const PUBLIC_PATHS = new Set(["/manifest.webmanifest", "/icon", "/apple-icon", "/favicon.ico"]);

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

export function phoneGatewayError(): string | null {
  return globalForGateway.__wavesmithPhone?.error ?? null;
}

export function phoneGatewayListening(): boolean {
  return globalForGateway.__wavesmithPhone?.server?.listening === true;
}

export function phoneGatewayHost(): string | null {
  return globalForGateway.__wavesmithPhone?.host ?? null;
}

export function phoneGatewayMode(): BindPlan["mode"] {
  return globalForGateway.__wavesmithPhone?.mode ?? "off";
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
    void handleGatewayRequest(req, res, opts);
  });
  server.on("upgrade", (req, socket) => {
    handleUpgrade(req, socket, opts);
  });
  return new Promise((resolve, reject) => {
    const fail = (err: Error) => {
      server.close();
      reject(err);
    };
    server.once("error", fail);
    server.listen(opts.port, opts.host, () => {
      server.off("error", fail);
      resolve(server);
    });
  });
}

async function verifyUpstream(port: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const mark = instanceMark();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: {
        [GATEWAY_SECRET_HEADER]: gatewaySecret(),
        [INSTANCE_PROBE_HEADER]: "1",
        host: `127.0.0.1:${port}`,
      },
      signal: AbortSignal.timeout(2000),
    });
    if (res.headers.get("x-wavesmith-instance") !== mark) {
      return {
        ok: false,
        reason: `Port ${port} is not this Wavesmith, so the phone door stayed closed.`,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: `Couldn't reach Wavesmith on 127.0.0.1:${port}, so the phone door stayed closed.`,
    };
  }
}

function remember(plan: BindPlan, port: number, server: http.Server | null, error: string | null): void {
  globalForGateway.__wavesmithPhone = {
    server,
    port,
    host: plan.host,
    error,
    mode: plan.mode,
  };
}

/** Open or close the listener so it matches Tailscale (or this run's Wi-Fi choice). */
export async function syncPhoneGateway(options?: { refreshTailscale?: boolean }): Promise<void> {
  const plan = planPhoneBind({
    enabled: phoneAccessEnabled(),
    lan: lanOptIn(),
    tailscale: await localTailscaleAddresses({ refresh: options?.refreshTailscale }),
  });
  const port = phoneListenPort();
  if (!plan.listen || !plan.host) {
    stopPhoneGateway();
    remember(plan, port, null, plan.reason);
    return;
  }
  const current = globalForGateway.__wavesmithPhone;
  if (current?.server?.listening && current.host === plan.host) return;
  stopPhoneGateway();
  const upstreamPort = appListenPort();
  const upstream = await verifyUpstream(upstreamPort);
  if (!upstream.ok) {
    remember(plan, port, null, upstream.reason);
    return;
  }
  const bound = gatewayStartAllowed(detectListens(), upstreamPort);
  if (!bound.ok) {
    console.error(`[phone] ${bound.reason}`);
    remember(plan, port, null, bound.reason);
    return;
  }
  try {
    const server = await startPhoneGateway({ host: plan.host, port, upstreamPort });
    remember(plan, port, server, null);
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Could not open phone access.";
    const message = raw.includes("EADDRINUSE")
      ? `Port ${port} is already in use. Close the other program, or set PHONE_PORT.`
      : raw;
    remember(plan, port, null, message);
  }
}

function clientAddress(req: http.IncomingMessage): string {
  return normalizeIp(req.socket.remoteAddress ?? "unknown");
}

function headerHost(req: http.IncomingMessage): string {
  const raw = req.headers.host ?? "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end === -1 ? raw : raw.slice(1, end);
  }
  return raw.split(":")[0] ?? "";
}

export function gatewayHostAllowed(req: http.IncomingMessage, bindHost: string): boolean {
  const host = normalizeIp(headerHost(req));
  const local = normalizeIp(req.socket.localAddress ?? "");
  if (!host) return false;
  if (isLoopbackHost(host) && (isLoopbackHost(local) || local === "")) return true;
  if (host === local) return true;
  if (bindHost !== "0.0.0.0" && host === normalizeIp(bindHost)) return true;
  return false;
}

function originAllowed(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || Array.isArray(origin) || Array.isArray(host)) return false;
  return originMatchesHost(origin, host ?? null);
}

let pairTail: Promise<void> = Promise.resolve();
let pairPending = 0;
const PAIR_PENDING_LIMIT = 8;

/** One wrong-code check at a time, so parallel guesses cannot skip the wait. */
function enqueuePair(task: () => Promise<void>): Promise<void> {
  const run = pairTail.then(task, task);
  pairTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function resetPairThrottle(): void {
  failures.clear();
  pairPending = 0;
  pairTail = Promise.resolve();
}

function pruneFailures(now: number): void {
  for (const [key, row] of failures) {
    if (now > row.resetAt) failures.delete(key);
  }
  while (failures.size > 200) {
    const oldest = failures.keys().next().value;
    if (!oldest) break;
    failures.delete(oldest);
  }
}

function noteFailure(address: string): void {
  const now = Date.now();
  pruneFailures(now);
  const row = failures.get(address);
  if (!row || now > row.resetAt) {
    failures.set(address, { count: 1, resetAt: now + FAIL_WINDOW_MS });
    return;
  }
  row.count += 1;
  row.resetAt = now + FAIL_WINDOW_MS;
}

function wrongCodeDelay(address: string): number {
  const row = failures.get(address);
  if (!row || Date.now() > row.resetAt) return 0;
  return Math.min(2000, 150 * 2 ** Math.min(row.count, 4));
}

async function handleGatewayRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: GatewayOptions,
): Promise<void> {
  if (!gatewayHostAllowed(req, opts.host)) {
    sendText(res, 403, "This address is not the phone door.");
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/pair") {
    await handlePair(req, res, url);
    return;
  }
  if (PUBLIC_PATHS.has(url.pathname)) {
    proxyToApp(req, res, opts.upstreamPort, null);
    return;
  }
  const token = readCookie(req.headers.cookie, PHONE_COOKIE);
  if (!deviceForToken(token)) {
    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 401, { error: "This phone is not paired. Scan the code on the computer." });
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      sendHtml(res, 200, pairPage({ message: null, code: "" }));
      return;
    }
    sendJson(res, 401, { error: "This phone is not paired. Scan the code on the computer." });
    return;
  }
  const method = (req.method ?? "GET").toUpperCase();
  if (url.pathname.startsWith("/api/") && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    if (!originAllowed(req)) {
      sendJson(res, 403, { error: "Use the Wavesmith page on this phone." });
      return;
    }
    if (req.headers[WAVESMITH_REQUEST_HEADER] !== "1") {
      sendJson(res, 403, { error: "Use the Wavesmith page on this phone." });
      return;
    }
    if (method !== "DELETE") {
      const contentType = String(req.headers["content-type"] ?? "");
      if (!isJsonMediaType(contentType)) {
        sendJson(res, 403, { error: "Use the Wavesmith page on this phone." });
        return;
      }
    }
  }
  const refresh = touchDevice(token, clientAddress(req));
  proxyToApp(req, res, opts.upstreamPort, refresh && token ? deviceCookie(token, false) : null);
}

async function handlePair(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const address = clientAddress(req);
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    sendHtml(res, 200, pairPage({ message: null, code: url.searchParams.get("code") ?? "" }));
    return;
  }
  if (!originAllowed(req)) {
    sendHtml(res, 403, pairPage({ message: "Open this page from the address on the computer.", code: "" }));
    return;
  }
  if (pairPending >= PAIR_PENDING_LIMIT) {
    sendHtml(res, 429, pairPage({ message: "Too many tries at once. Wait a moment and try again.", code: "" }));
    return;
  }
  pairPending += 1;
  const code = (await readFormCode(req)) ?? "";
  try {
    await enqueuePair(async () => {
      if (!code.trim()) {
        sendHtml(res, 200, pairPage({ message: null, code: "" }));
        return;
      }
      const redeemed = redeemInvite({
        code,
        label: deviceLabel(headerString(req.headers["user-agent"])),
        address,
        userAgent: headerString(req.headers["user-agent"]) ?? "",
      });
      if (!redeemed) {
        noteFailure(address);
        const wait = wrongCodeDelay(address);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        sendHtml(
          res,
          403,
          pairPage({
            message: "That code doesn't match. Check the computer and try again in a moment.",
            code,
          }),
        );
        return;
      }
      failures.delete(address);
      res.writeHead(302, {
        Location: "/",
        "Set-Cookie": deviceCookie(redeemed.token, false),
        "Cache-Control": "no-store",
      });
      res.end();
    });
  } finally {
    pairPending -= 1;
  }
}

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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

function proxyToApp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstreamPort: number,
  refreshCookie: string | null,
): void {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key) || key.startsWith("x-forwarded-") || key === "x-real-ip") continue;
    if (key === GATEWAY_SECRET_HEADER || key === "x-wavesmith-client" || key === INSTANCE_PROBE_HEADER) continue;
    headers[key] = value;
  }
  if (typeof headers.cookie === "string") {
    headers.cookie = headers.cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith(`${PHONE_COOKIE}=`))
      .join("; ");
  }
  headers[GATEWAY_SECRET_HEADER] = gatewaySecret();
  headers["x-wavesmith-client"] = "phone";
  headers.host = `127.0.0.1:${upstreamPort}`;
  headers["x-forwarded-for"] = clientAddress(req);
  headers["x-forwarded-host"] = headerHost(req);
  // The phone door is plain HTTP. A client X-Forwarded-Proto is not how we were reached.
  headers["x-forwarded-proto"] = "http";
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
      delete out["x-wavesmith-instance"];
      if (refreshCookie) {
        const existing = out["set-cookie"];
        if (!existing) out["set-cookie"] = refreshCookie;
        else if (Array.isArray(existing)) out["set-cookie"] = [...existing, refreshCookie];
        else out["set-cookie"] = [existing, refreshCookie];
      }
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

function handleUpgrade(req: http.IncomingMessage, socket: import("node:stream").Duplex, opts: GatewayOptions): void {
  if (!gatewayHostAllowed(req, opts.host)) {
    socket.destroy();
    return;
  }
  const token = readCookie(req.headers.cookie, PHONE_COOKIE);
  if (!deviceForToken(token)) {
    socket.destroy();
    return;
  }
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.startsWith("x-forwarded-") || key === GATEWAY_SECRET_HEADER) continue;
    if (key === "proxy-authorization" || key === "proxy-authenticate") continue;
    headers[key] = value;
  }
  headers[GATEWAY_SECRET_HEADER] = gatewaySecret();
  headers.host = `127.0.0.1:${opts.upstreamPort}`;
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: opts.upstreamPort,
    method: "GET",
    path: req.url,
    headers,
  });
  upstream.on("upgrade", (up, upSocket, head) => {
    const lines = [`HTTP/1.1 ${up.statusCode ?? 101} ${up.statusMessage ?? "Switching Protocols"}`];
    for (const [key, value] of Object.entries(up.headers)) {
      if (value == null) continue;
      const list = Array.isArray(value) ? value : [value];
      for (const item of list) lines.push(`${key}: ${item}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) socket.write(head);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
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
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function pairPage(input: { message: string | null; code: string }): string {
  const note = input.message ? `<p class="warn" role="alert">${escapeHtml(input.message)}</p>` : "";
  const value = escapeHtml(input.code);
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
    <p>Wavesmith is running on the computer. Ask the person there for the pairing code, or scan the QR code with your camera, then tap Pair.</p>
    ${note}
    <form method="post" action="/pair">
      <label>Pairing code
        <input name="code" value="${value}" maxlength="9" placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" required>
      </label>
      <button type="submit">Pair</button>
    </form>
  </main>
</body>
</html>`;
}
