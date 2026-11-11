/**
 * Phone access: the Mac is a loopback peer, a phone is the gateway secret,
 * and the door binds Tailscale unless this process explicitly opts into Wi-Fi.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { POST as importPOST } from "@/app/api/library/import/route";
import { GET as settingsGET, PATCH as settingsPATCH } from "@/app/api/settings/route";
import { GET as phoneGET, POST as phonePOST } from "@/app/api/phone/route";
import { db, schema } from "@/lib/db";
import { AceStepClient } from "@/lib/engine/acestep";
import { getConnectionMode, setConnectionMode } from "@/lib/grok/mode";
import { readGrokApiKey, saveGrokApiKey } from "@/lib/grok/secrets";
import { authorizeWrite, classifyRequest } from "@/lib/phone/access";
import { beginPhoneProcess, isTailscaleIPv4, isTailscaleIPv6, lanDisplayAddresses, lanOptIn, planPhoneBind, setLanOptIn } from "@/lib/phone/bind";
import { DEVICE_COOKIE_MAX_AGE, deviceCookie } from "@/lib/phone/codes";
import { devOriginAllowed } from "@/lib/phone/dev-origins";
import { gatewayHostAllowed, phoneGatewayError, phoneGatewayListening, startPhoneGateway, stopPhoneGateway, syncPhoneGateway } from "@/lib/phone/gateway";
import { GATEWAY_SECRET_HEADER, PEER_HEADER, WAVESMITH_REQUEST_HEADER } from "@/lib/phone/headers";
import { gatewayStartAllowed } from "@/lib/phone/listen";
import { assertLoopbackBaseUrl } from "@/lib/phone/loopback";
import { installPeerStamp, peerIsLoopback } from "@/lib/phone/peer-stamp";
import { gatewaySecret } from "@/lib/phone/secret";
import {
  currentInvite,
  deviceForToken,
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
    const app = http.createServer((req, res) => {
      seenHost = String(req.headers.host);
      seenClient = String(req.headers["x-wavesmith-client"]);
      seenRange = String(req.headers.range);
      seenForwarded = String(req.headers["x-forwarded-host"]);
      seenProxy = String(req.headers["proxy-authorization"] ?? "");
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
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: pairBody(invite.code),
    });
    expect(paired.status).toBe(302);
    const cookie = paired.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("ws_device=");
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
      headers: { cookie: cookie.split(";")[0] ?? "", Range: "bytes=0-3" },
    });
    expect(audio.status).toBe(206);
    expect(await audio.text()).toBe("abcd");
    expect(seenHost).toBe(`127.0.0.1:${appPort}`);
    expect(seenClient).toBe("phone");
    expect(seenRange).toBe("bytes=0-3");
    expect(seenForwarded).toBe("127.0.0.1");
    expect(seenProxy).toBe("");

    revokeDevice(device!.id);
    const gone = await fetch(`${origin}/api/songs`, { headers: { cookie: cookie.split(";")[0] ?? "" } });
    expect(gone.status).toBe(401);
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

  it("stamps the real peer over a forged X-Forwarded-For", async () => {
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
  });
});
