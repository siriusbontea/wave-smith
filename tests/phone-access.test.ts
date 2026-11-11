/**
 * Phone access: the Mac is a loopback peer, a phone is the gateway secret,
 * and the door binds Tailscale unless this process explicitly opts into Wi-Fi.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { POST as importPOST } from "@/app/api/library/import/route";
import { GET as settingsGET, PATCH as settingsPATCH } from "@/app/api/settings/route";
import { GET as phoneGET, POST as phonePOST } from "@/app/api/phone/route";
import { db, schema } from "@/lib/db";
import { AceStepClient } from "@/lib/engine/acestep";
import { getConnectionMode, setConnectionMode } from "@/lib/grok/mode";
import { readGrokApiKey, saveGrokApiKey } from "@/lib/grok/secrets";
import { authorizeWrite, classifyRequest, isJsonMediaType } from "@/lib/phone/access";
import { beginPhoneProcess, confirmedTailscaleAddresses, isTailscaleIPv4, isTailscaleIPv6, lanDisplayAddresses, lanOptIn, localTailscaleAddresses, planPhoneBind, setInterfaceSourceForTests, setLanOptIn, setTailscaleRunnerForTests, type NamedInterface } from "@/lib/phone/bind";
import { DEVICE_COOKIE_MAX_AGE, PHONE_COOKIE, deviceCookie } from "@/lib/phone/codes";
import { devOriginAllowed } from "@/lib/phone/dev-origins";
import { adoptPhoneListenerForTests, gatewayHostAllowed, phoneGatewayError, phoneGatewayListening, resetPairThrottle, setPhoneSyncObserverForTests, startPhoneGateway, stopPhoneGateway, syncPhoneGateway } from "@/lib/phone/gateway";
import { GATEWAY_SECRET_HEADER, PEER_HEADER, VIA_PROXY_HEADER, WAVESMITH_REQUEST_HEADER } from "@/lib/phone/headers";
import { gatewayStartAllowed } from "@/lib/phone/listen";
import { assertLoopbackBaseUrl } from "@/lib/phone/loopback";
import { mintId } from "@/lib/client/intent";
import { installPeerStamp, peerIsLoopback, stampPeer } from "@/lib/phone/peer-stamp";
import { recheckNote } from "@/lib/phone/recheck-note";
import { gatewaySecret } from "@/lib/phone/secret";
import { phoneStatus } from "@/lib/phone/status";
import {
  currentInvite,
  deviceForToken,
  ensureInvite,
  INVITE_TTL_MS,
  phoneAccessEnabled,
  redeemInvite,
  revokeDevice,
  rotateInvite,
  setPhoneAccessEnabled,
} from "@/lib/phone/store";

const servers: http.Server[] = [];

afterEach(async () => {
  setLanOptIn(false);
  setPhoneAccessEnabled(false);
  setTailscaleRunnerForTests(null);
  setInterfaceSourceForTests(null);
  setPhoneSyncObserverForTests(null);
  resetPairThrottle();
  stopPhoneGateway();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function macRequest(url: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set(PEER_HEADER, "127.0.0.1");
  if (!headers.has("host")) headers.set("host", "127.0.0.1:3000");
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    headers.set(WAVESMITH_REQUEST_HEADER, "1");
    if (!headers.has("origin")) headers.set("origin", "http://127.0.0.1:3000");
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  return new Request(url, { ...init, headers });
}

function phoneRequest(url: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set(GATEWAY_SECRET_HEADER, gatewaySecret());
  headers.set(PEER_HEADER, "100.64.0.8");
  if (!headers.has("host")) headers.set("host", "100.64.0.8:8787");
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    headers.set(WAVESMITH_REQUEST_HEADER, "1");
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  return new Request(url, { ...init, headers });
}

function pairBody(code: string): string {
  return `code=${encodeURIComponent(code)}`;
}

describe("loopback backends", () => {
  it("refuses an engine or lyrics URL that is not on this computer", () => {
    expect(() => new AceStepClient("http://192.168.1.9:8001")).toThrow(/this computer/);
    expect(() => assertLoopbackBaseUrl("http://10.0.0.8:11434", "LYRICS_LLM_URL")).toThrow(/this computer/);
    expect(() => startPhoneGateway({ host: "127.0.0.1", port: 0, upstreamPort: 8001 })).toThrow(
      /music engine port/,
    );
  });
});

describe("who is calling", () => {
  it("treats a missing peer as rejected, and a wrong secret as rejected", () => {
    expect(classifyRequest(new Request("http://127.0.0.1:3000/api/phone"))).toBe("rejected");
    expect(
      classifyRequest(
        new Request("http://127.0.0.1:3000/api/phone", {
          headers: {
            [PEER_HEADER]: "127.0.0.1",
            host: "127.0.0.1:3000",
            [GATEWAY_SECRET_HEADER]: "not-the-secret",
          },
        }),
      ),
    ).toBe("rejected");
  });

  it("is the Mac only for a loopback peer and a loopback Host", () => {
    expect(classifyRequest(macRequest("http://127.0.0.1:3000/api/phone"))).toBe("mac");
    expect(
      classifyRequest(
        new Request("http://example.invalid/api/phone", {
          headers: { [PEER_HEADER]: "127.0.0.1", host: "example.invalid" },
        }),
      ),
    ).toBe("rejected");
    expect(
      classifyRequest(
        new Request("http://127.0.0.1:3000/api/phone", {
          headers: { [PEER_HEADER]: "127.0.0.1", host: "127.0.0.1:3000", "tailscale-user-login": "sirius" },
        }),
      ),
    ).toBe("rejected");
  });

  it("is a phone when the gateway secret matches, even from loopback", () => {
    expect(
      classifyRequest(
        new Request("http://127.0.0.1:3000/api/phone", {
          headers: {
            [GATEWAY_SECRET_HEADER]: gatewaySecret(),
            [PEER_HEADER]: "127.0.0.1",
            host: "127.0.0.1:3000",
          },
        }),
      ),
    ).toBe("phone");
  });

  it("rejects text/plain and a foreign Origin on a Mac write", async () => {
    const plain = macRequest("http://127.0.0.1:3000/api/phone", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "http://example.invalid" },
      body: JSON.stringify({ action: "enable" }),
    });
    expect(authorizeWrite(plain, "mac").ok).toBe(false);
    const acted = await phonePOST(plain);
    expect(acted.status).toBe(403);
    expect(phoneAccessEnabled()).toBe(false);

    const foreign = macRequest("http://127.0.0.1:3000/api/phone", {
      method: "POST",
      headers: { origin: "http://example.invalid" },
      body: JSON.stringify({ action: "enable" }),
    });
    expect(authorizeWrite(foreign, "mac").ok).toBe(false);
    expect((await phonePOST(foreign)).status).toBe(403);

    const wrongPort = macRequest("http://127.0.0.1:3000/api/phone", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:9999" },
      body: JSON.stringify({ action: "enable" }),
    });
    expect(authorizeWrite(wrongPort, "mac").ok).toBe(false);
    expect(isJsonMediaType("application/json; charset=utf-8")).toBe(true);
    expect(isJsonMediaType("application/jsonx")).toBe(false);
    const fakeJson = macRequest("http://127.0.0.1:3000/api/phone", {
      method: "POST",
      headers: { "content-type": "application/jsonx" },
      body: JSON.stringify({ action: "enable" }),
    });
    expect(authorizeWrite(fakeJson, "mac").ok).toBe(false);
  });
});

describe("bind target", () => {
  it("stays closed without Tailscale, and binds the tailnet address when one exists", () => {
    const missing = planPhoneBind({ enabled: true, lan: false, tailscale: ["192.168.1.5", "100.63.1.1"] });
    expect(missing.listen).toBe(false);
    expect(missing.reason).toMatch(/Tailscale isn't running/);
    expect(isTailscaleIPv4("100.63.1.1")).toBe(false);
    expect(isTailscaleIPv4("100.64.1.2")).toBe(true);
    expect(isTailscaleIPv4("100.128.1.1")).toBe(false);
    expect(isTailscaleIPv6("fd7a:115c:a1e0::8")).toBe(true);
    expect(
      confirmedTailscaleAddresses({
        reported: [],
        interfaces: [
          { name: "en0", address: "100.64.12.7" },
          { name: "CloudflareWARP", address: "100.96.0.5" },
          { name: "utun4", address: "100.64.1.2" },
        ],
      }),
    ).toEqual([]);
    expect(
      confirmedTailscaleAddresses({
        reported: ["100.64.1.2"],
        interfaces: [
          { name: "en0", address: "100.64.12.7" },
          { name: "utun4", address: "100.64.1.2" },
        ],
      }),
    ).toEqual(["100.64.1.2"]);
    expect(
      confirmedTailscaleAddresses({
        reported: [],
        interfaces: [{ name: "tailscale0", address: "100.64.8.8" }],
      }),
    ).toEqual(["100.64.8.8"]);

    const present = planPhoneBind({
      enabled: true,
      lan: false,
      tailscale: ["192.168.1.5", "fd7a:115c:a1e0::8", "100.64.1.2"],
    });
    expect(present).toMatchObject({ listen: true, host: "100.64.1.2", mode: "tailscale" });
  });

  it("treats home Wi-Fi as a choice this process forgets", () => {
    expect(planPhoneBind({ enabled: true, lan: true, tailscale: [] }).host).toBe("0.0.0.0");
    setLanOptIn(true);
    expect(lanOptIn()).toBe(true);
    beginPhoneProcess();
    expect(lanOptIn()).toBe(false);
    expect(
      gatewayStartAllowed(
        [
          { address: "127.0.0.1", port: 3000 },
          { address: "0.0.0.0", port: 3000 },
        ],
        3000,
      ).ok,
    ).toBe(false);
    expect(gatewayStartAllowed([{ address: "127.0.0.1", port: 3000 }], 3000).ok).toBe(true);
    expect(gatewayStartAllowed(null, 3000).ok).toBe(false);
  });

  it("does not open the door when Tailscale is absent", async () => {
    setPhoneAccessEnabled(true);
    await syncPhoneGateway();
    expect(phoneGatewayListening()).toBe(false);
    expect(phoneGatewayError()).toMatch(/Tailscale|127\.0\.0\.1/);
  });

  it("ranks a real Wi-Fi address ahead of a bridge", () => {
    expect(
      lanDisplayAddresses([
        { name: "bridge100", address: "192.168.64.1" },
        { name: "en0", address: "192.168.1.20" },
        { name: "utun", address: "100.64.0.2" },
      ])[0],
    ).toBe("192.168.1.20");
  });
});

describe("pairing codes and revocation", () => {
  it("expires a code after ten minutes and rejects it after rotation", () => {
    const invite = rotateInvite();
    db.update(schema.phoneInvites)
      .set({ createdAt: Date.now() - INVITE_TTL_MS - 1000 })
      .where(eq(schema.phoneInvites.code, invite.code))
      .run();
    expect(currentInvite()).toBeNull();
    expect(
      redeemInvite({ code: invite.code, label: "iPhone", address: "100.64.0.2", userAgent: "iPhone" }),
    ).toBeNull();

    const fresh = rotateInvite();
    const again = rotateInvite();
    expect(again.code).not.toBe(fresh.code);
    expect(
      redeemInvite({ code: fresh.code, label: "iPhone", address: "100.64.0.2", userAgent: "iPhone" }),
    ).toBeNull();
  });

  it("forgets every phone when access is turned off, and drops an idle phone", () => {
    setPhoneAccessEnabled(true);
    const invite = rotateInvite();
    const redeemed = redeemInvite({
      code: invite.code,
      label: "iPhone",
      address: "100.64.0.8",
      userAgent: "iPhone",
    });
    expect(redeemed).not.toBeNull();
    expect(deviceForToken(redeemed!.token)?.lastAddress).toBe("100.64.0.8");
    const next = currentInvite();
    expect(next).not.toBeNull();
    expect(next!.code).not.toBe(invite.code);

    setPhoneAccessEnabled(false);
    expect(deviceForToken(redeemed!.token)).toBeNull();
    expect(currentInvite()).toBeNull();

    setPhoneAccessEnabled(true);
    const second = rotateInvite();
    const kept = redeemInvite({
      code: second.code,
      label: "iPad",
      address: "100.64.0.9",
      userAgent: "iPad",
    });
    expect(kept).not.toBeNull();
    db.update(schema.phoneDevices)
      .set({ lastSeenAt: Date.now() - 31 * 24 * 60 * 60 * 1000 })
      .where(eq(schema.phoneDevices.id, kept!.deviceId))
      .run();
    expect(deviceForToken(kept!.token)).toBeNull();
  });

  it("returns 404 when removing a phone that is not paired", async () => {
    const res = await phonePOST(
      macRequest("http://127.0.0.1:3000/api/phone", {
        method: "POST",
        body: JSON.stringify({ action: "revoke", deviceId: "missing" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("phone gateway", () => {
  it("rejects an unpaired API call and still serves the manifest", async () => {
    let appHits = 0;
    const app = http.createServer((req, res) => {
      appHits += 1;
      res.end(String(req.url));
    });
    const appPort = await listen(app);
    const gateway = await startPhoneGateway({ host: "127.0.0.1", port: 0, upstreamPort: appPort });
    servers.push(gateway);
    const port = (gateway.address() as AddressInfo).port;

    const api = await fetch(`http://127.0.0.1:${port}/api/songs`);
    expect(api.status).toBe(401);
    expect(api.headers.get("content-type")).toContain("application/json");
    expect(appHits).toBe(0);

    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Pair this phone");
    expect(appHits).toBe(0);

    const manifest = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(await manifest.text()).toBe("/manifest.webmanifest");
    expect(appHits).toBe(1);

    const foreign = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port, path: "/api/songs", headers: { host: "example.invalid" } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(foreign).toBe(403);
    expect(appHits).toBe(1);
    expect(
      gatewayHostAllowed(
        { headers: { host: "example.invalid" }, socket: { localAddress: "127.0.0.1" } } as http.IncomingMessage,
        "127.0.0.1",
      ),
    ).toBe(false);
  });

  it("does not redeem a code from a link, then pairs on POST and proxies Range", async () => {
    const invite = rotateInvite();
    let seenHost = "";
    let seenClient = "";
    let seenRange = "";
    let seenForwarded = "";
    let seenProxy = "";
    let seenProto = "";
    const app = http.createServer((req, res) => {
      seenHost = String(req.headers.host);
      seenClient = String(req.headers["x-wavesmith-client"]);
      seenRange = String(req.headers.range);
      seenForwarded = String(req.headers["x-forwarded-host"]);
      seenProxy = String(req.headers["proxy-authorization"] ?? "");
      seenProto = String(req.headers["x-forwarded-proto"] ?? "");
      res.writeHead(206, {
        "Content-Type": "audio/mpeg",
        "Content-Range": "bytes 0-3/10",
        "Accept-Ranges": "bytes",
        "Content-Length": "4",
      });
      res.end("abcd");
    });
    const appPort = await listen(app);
    const gateway = await startPhoneGateway({ host: "127.0.0.1", port: 0, upstreamPort: appPort });
    servers.push(gateway);
    const port = (gateway.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;

    const preview = await fetch(`${origin}/pair?code=${encodeURIComponent(invite.code)}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("set-cookie")).toBeNull();
    expect(await preview.text()).toContain(invite.code);
    expect(currentInvite()?.code).toBe(invite.code);

    const wrong = await fetch(`${origin}/pair`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: pairBody("ZZZZ-ZZZZ"),
    });
    expect(wrong.status).toBe(403);
    expect(await wrong.text()).toContain("doesn't match");

    const paired = await fetch(`${origin}/pair`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin,
        "x-forwarded-proto": "https",
      },
      body: pairBody(invite.code),
    });
    expect(paired.status).toBe(302);
    const cookie = paired.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("ws_device=");
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain(`Max-Age=${DEVICE_COOKIE_MAX_AGE}`);
    const token = cookie.split(";")[0]?.split("=")[1] ?? "";
    const device = deviceForToken(decodeURIComponent(token));
    expect(device).not.toBeNull();

    const reused = await fetch(`${origin}/pair`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: pairBody(invite.code),
    });
    expect(reused.status).toBe(403);

    const forged = await fetch(`${origin}/api/audio/demo.mp3`, {
      headers: {
        cookie: cookie.split(";")[0] ?? "",
        Range: "bytes=0-3",
        "x-forwarded-host": "evil.example",
        "proxy-authorization": "secret",
        "content-type": "text/plain",
        origin: "http://example.invalid",
      },
      method: "POST",
    });
    expect(forged.status).toBe(403);

    const audio = await fetch(`${origin}/api/audio/demo.mp3`, {
      headers: {
        cookie: cookie.split(";")[0] ?? "",
        Range: "bytes=0-3",
        "x-forwarded-proto": "https",
      },
    });
    expect(audio.status).toBe(206);
    expect(await audio.text()).toBe("abcd");
    expect(seenHost).toBe(`127.0.0.1:${appPort}`);
    expect(seenClient).toBe("phone");
    expect(seenRange).toBe("bytes=0-3");
    expect(seenForwarded).toBe("127.0.0.1");
    expect(seenProxy).toBe("");
    expect(seenProto).toBe("http");

    revokeDevice(device!.id);
    const gone = await fetch(`${origin}/api/songs`, { headers: { cookie: cookie.split(";")[0] ?? "" } });
    expect(gone.status).toBe(401);
  });

  it("makes parallel wrong codes wait one after another", async () => {
    rotateInvite();
    const app = http.createServer((_req, res) => {
      res.end("ok");
    });
    const appPort = await listen(app);
    const gateway = await startPhoneGateway({ host: "127.0.0.1", port: 0, upstreamPort: appPort });
    servers.push(gateway);
    const port = (gateway.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const started = Date.now();
    const attempt = () =>
      fetch(`${origin}/pair`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin },
        body: pairBody("ZZZZ-ZZZZ"),
      });
    const [first, second] = await Promise.all([attempt(), attempt()]);
    expect(first.status).toBe(403);
    expect(second.status).toBe(403);
    expect(Date.now() - started).toBeGreaterThan(700);
  });
});

describe("phone API secrets", () => {
  it("does not send the xAI key to a phone, or let a phone change Mac settings", async () => {
    const secret = "xai-test-key-should-not-leak";
    saveGrokApiKey(secret);
    setConnectionMode("local");
    const mac = await settingsGET(macRequest("http://127.0.0.1:3000/api/settings"));
    expect(mac.status).toBe(200);
    expect(await mac.text()).not.toContain(secret);

    const denied = await settingsPATCH(
      phoneRequest("http://127.0.0.1:3000/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ xaiApiKey: "typed-on-the-phone", connectionMode: "grok" }),
      }),
    );
    expect(denied.status).toBe(403);
    expect(readGrokApiKey().key).toBe(secret);
    expect(getConnectionMode()).toBe("local");

    const imported = await importPOST(
      phoneRequest("http://127.0.0.1:3000/api/library/import", {
        method: "POST",
        body: JSON.stringify({ songs: [] }),
      }),
    );
    expect(imported.status).toBe(403);

    const invite = rotateInvite();
    const phone = await phoneGET(phoneRequest("http://127.0.0.1:3000/api/phone"));
    const body = (await phone.json()) as { invite: unknown; urls: string[]; devices: unknown[] };
    expect(body.invite).toBeNull();
    expect(body.urls).toEqual([]);
    expect(body.devices).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(invite.code);

    const blocked = await phonePOST(
      phoneRequest("http://127.0.0.1:3000/api/phone", {
        method: "POST",
        body: JSON.stringify({ action: "disable" }),
      }),
    );
    expect(blocked.status).toBe(403);
  });
});

describe("dev origins and cookies", () => {
  it("allows private ranges for next dev and marks the cookie Secure on https", () => {
    expect(devOriginAllowed("100.64.1.2")).toBe(true);
    expect(devOriginAllowed("100.1.1.1")).toBe(false);
    expect(devOriginAllowed("192.168.1.9")).toBe(true);
    expect(devOriginAllowed("172.16.0.4")).toBe(true);
    expect(devOriginAllowed("172.32.0.4")).toBe(false);
    expect(devOriginAllowed("evil.com")).toBe(false);
    expect(deviceCookie("abc", true)).toContain("Secure");
    expect(deviceCookie("abc")).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    expect(deviceCookie("abc")).not.toContain("Secure");
  });

  it("mints a click key without crypto.randomUUID", () => {
    const id = mintId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("stamps the real peer over a forged X-Forwarded-For, and a second stamp keeps the flag", async () => {
    installPeerStamp();
    installPeerStamp();
    const seen: { peer?: string; forwarded?: string; via?: string } = {};
    const app = http.createServer((req, res) => {
      seen.peer = String(req.headers["x-wavesmith-peer"]);
      seen.forwarded = String(req.headers["x-forwarded-for"]);
      seen.via = String(req.headers["x-wavesmith-via-proxy"] ?? "");
      res.end("ok");
    });
    const port = await listen(app);
    await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(peerIsLoopback(seen.peer)).toBe(true);
    expect(seen.forwarded).not.toContain("1.2.3.4");
    expect(seen.via).toBe("1");

    const twice = {
      headers: { "x-forwarded-for": "100.101.1.2" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as http.IncomingMessage;
    stampPeer(twice);
    stampPeer(twice);
    expect(twice.headers["x-wavesmith-via-proxy"]).toBe("1");
    expect(twice.headers["x-forwarded-for"]).toBe("127.0.0.1");
  });

  it("treats X-Real-IP without X-Forwarded-For as a proxy and refuses the Mac", () => {
    const raw = {
      headers: { "x-real-ip": "203.0.113.8" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as http.IncomingMessage;
    stampPeer(raw);
    expect(raw.headers["x-real-ip"]).toBeUndefined();
    expect(raw.headers[VIA_PROXY_HEADER]).toBe("1");
    expect(raw.headers["x-forwarded-for"]).toBe("127.0.0.1");

    const stamped = new Request("http://127.0.0.1:3000/api/phone", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
        [WAVESMITH_REQUEST_HEADER]: "1",
        [PEER_HEADER]: String(raw.headers["x-wavesmith-peer"]),
        [VIA_PROXY_HEADER]: String(raw.headers[VIA_PROXY_HEADER]),
      },
      body: JSON.stringify({ action: "enable" }),
    });
    expect(classifyRequest(stamped)).toBe("rejected");
    const write = authorizeWrite(stamped, classifyRequest(stamped));
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.status).toBe(403);

    const same = {
      headers: { "x-real-ip": "127.0.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as http.IncomingMessage;
    stampPeer(same);
    expect(same.headers[VIA_PROXY_HEADER]).toBeUndefined();
  });
});

describe("Tailscale lookup", () => {
  it("does not block the event loop, and a timeout leaves the door closed", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setTailscaleRunnerForTests(async () => {
      await gate;
      throw new Error("timeout");
    });
    const pending = localTailscaleAddresses({ refresh: true });
    let ticked = false;
    setTimeout(() => {
      ticked = true;
    }, 20);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(ticked).toBe(true);
    release();
    const ips = await pending;
    expect(ips).toEqual([]);
    expect(planPhoneBind({ enabled: true, lan: false, tailscale: ips }).listen).toBe(false);
  });

  it("caches the CLI result and runs it again when asked", async () => {
    let calls = 0;
    setTailscaleRunnerForTests(async () => {
      calls += 1;
      return "";
    });
    await localTailscaleAddresses({ refresh: true });
    await localTailscaleAddresses();
    expect(calls).toBe(4);
    await localTailscaleAddresses({ refresh: true });
    expect(calls).toBe(8);
  });

  it("fails closed when the CLI ignores SIGTERM", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wavesmith-tailscale-"));
    const bin = path.join(dir, "tailscale");
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env node
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`,
    );
    fs.chmodSync(bin, 0o755);
    const previous = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${previous ?? ""}`;
    setTailscaleRunnerForTests(null);
    const started = Date.now();
    try {
      const ips = await localTailscaleAddresses({ refresh: true });
      const elapsed = Date.now() - started;
      expect(ips).toEqual([]);
      expect(planPhoneBind({ enabled: true, lan: false, tailscale: ips }).listen).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(1_900);
      expect(elapsed).toBeLessThan(4_500);
    } finally {
      process.env.PATH = previous;
      spawnSync("pkill", ["-KILL", "-f", bin]);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 8_000);

  it("drops a cached address when the interface is gone, without calling the CLI", async () => {
    setPhoneAccessEnabled(true);
    const up: NamedInterface[] = [{ name: "tailscale0", address: "100.64.1.2" }];
    let interfaces = up;
    setInterfaceSourceForTests(() => interfaces);
    let mode: "up" | "hang" = "up";
    setTailscaleRunnerForTests(async () => {
      if (mode === "hang") return new Promise<string>(() => {});
      return "100.64.1.2\n";
    });
    expect(await localTailscaleAddresses({ refresh: true })).toEqual(["100.64.1.2"]);

    const door = http.createServer((_req, res) => res.end("ok"));
    const port = await listen(door);
    expect(port).toBeGreaterThan(0);
    adoptPhoneListenerForTests(door, "100.64.1.2");
    expect(phoneGatewayListening()).toBe(true);

    interfaces = [];
    mode = "hang";
    const started = Date.now();
    await syncPhoneGateway();
    expect(Date.now() - started).toBeLessThan(500);
    expect(phoneGatewayListening()).toBe(false);
    expect(phoneGatewayError()).toMatch(/Tailscale/);
  });

  it("discards an older sync that would reopen the door", async () => {
    setPhoneAccessEnabled(true);
    setInterfaceSourceForTests(() => [{ name: "utun4", address: "100.64.1.2" }]);
    let waiting = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setTailscaleRunnerForTests(async () => {
      waiting += 1;
      if (waiting <= 4) {
        await gate;
        return "100.64.1.2\n";
      }
      return "";
    });
    const applied: boolean[] = [];
    setPhoneSyncObserverForTests((plan) => applied.push(plan.listen));
    const first = syncPhoneGateway();
    const deadline = Date.now() + 1_000;
    while (waiting < 4 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(4);
    const second = syncPhoneGateway({ refreshTailscale: true });
    release();
    await first;
    await second;
    expect(applied).toEqual([false]);
    expect(phoneGatewayListening()).toBe(false);
  });

  async function warmOpenDoor(): Promise<{ cliCalls: () => number }> {
    setPhoneAccessEnabled(true);
    setInterfaceSourceForTests(() => [{ name: "utun4", address: "100.64.1.2" }]);
    let mode: "up" | "down" = "up";
    let calls = 0;
    setTailscaleRunnerForTests(async () => {
      calls += 1;
      return mode === "up" ? "100.64.1.2\n" : "";
    });
    expect(await localTailscaleAddresses({ refresh: true })).toEqual(["100.64.1.2"]);
    const door = http.createServer((_req, res) => res.end("ok"));
    await listen(door);
    adoptPhoneListenerForTests(door, "100.64.1.2");
    expect(phoneGatewayListening()).toBe(true);
    mode = "down";
    const baseline = calls;
    return { cliCalls: () => calls - baseline };
  }

  async function expectClosedByCli(cliCalls: () => number): Promise<void> {
    expect(phoneGatewayListening()).toBe(false);
    expect(cliCalls()).toBeGreaterThan(0);
    const status = await phoneStatus(false);
    expect(recheckNote(status)).toBe("Checked — no change, Tailscale still not found");
  }

  it("closes the door when a poll and Check again run in the same tick, poll first", async () => {
    const { cliCalls } = await warmOpenDoor();
    const poll = syncPhoneGateway();
    const check = syncPhoneGateway({ refreshTailscale: true });
    await poll;
    await check;
    await expectClosedByCli(cliCalls);
  });

  it("closes the door when Check again and a poll run in the same tick, check first", async () => {
    const { cliCalls } = await warmOpenDoor();
    const check = syncPhoneGateway({ refreshTailscale: true });
    const poll = syncPhoneGateway();
    await check;
    await poll;
    await expectClosedByCli(cliCalls);
    expect(cliCalls()).toBe(4);
  });

  it("closes an open door when the CLI is down even if the address is still local", async () => {
    const { cliCalls } = await warmOpenDoor();
    await syncPhoneGateway();
    await expectClosedByCli(cliCalls);
    expect(cliCalls()).toBe(4);
  });

  it("does not forward X-Real-IP on a WebSocket upgrade", async () => {
    setPhoneAccessEnabled(true);
    const invite = ensureInvite();
    const redeemed = redeemInvite({
      code: invite.code,
      label: "iPhone",
      address: "100.64.0.2",
      userAgent: "iPhone",
    });
    expect(redeemed).not.toBeNull();
    const seen: { realIp?: string; secret?: string } = {};
    const upstream = http.createServer();
    upstream.on("upgrade", (req, socket) => {
      seen.realIp = req.headers["x-real-ip"] as string | undefined;
      seen.secret = req.headers["x-wavesmith-gateway"] as string | undefined;
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
      socket.end();
    });
    const upstreamPort = await listen(upstream);
    const door = await startPhoneGateway({ host: "127.0.0.1", port: 0, upstreamPort });
    const doorPort = (door.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: doorPort,
        path: "/_next/webpack-hmr",
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          host: `127.0.0.1:${doorPort}`,
          "x-real-ip": "203.0.113.8",
          cookie: `${PHONE_COOKIE}=${encodeURIComponent(redeemed!.token)}`,
        },
      });
      req.on("upgrade", () => resolve());
      req.on("error", reject);
      req.end();
    });
    expect(seen.realIp).toBeUndefined();
    expect(seen.secret).toBeTruthy();
    door.close();
  });
});
