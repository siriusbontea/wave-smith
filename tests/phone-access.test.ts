/**
 * Phone access: an unpaired request never reaches the app, and the app will
 * not call a music engine that is not on this computer.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { GET as settingsGET, PATCH as settingsPATCH } from "@/app/api/settings/route";
import { GET as phoneGET, POST as phonePOST } from "@/app/api/phone/route";
import { AceStepClient } from "@/lib/engine/acestep";
import { readGrokApiKey, saveGrokApiKey } from "@/lib/grok/secrets";
import { PHONE_CLIENT_HEADER } from "@/lib/phone/client";
import { phoneBindHost, startPhoneGateway } from "@/lib/phone/gateway";
import { assertLoopbackBaseUrl } from "@/lib/phone/loopback";
import { rotateInvite } from "@/lib/phone/store";

const servers: http.Server[] = [];

afterEach(async () => {
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

describe("loopback backends", () => {
  it("refuses an engine or lyrics URL that is not on this computer", () => {
    expect(() => new AceStepClient("http://192.168.1.9:8001")).toThrow(/this computer/);
    expect(() => assertLoopbackBaseUrl("http://10.0.0.8:11434", "LYRICS_LLM_URL")).toThrow(/this computer/);
    expect(phoneBindHost()).toBe("0.0.0.0");
    expect(() => startPhoneGateway({ host: "127.0.0.1", port: 0, upstreamPort: 8001 })).toThrow(
      /music engine port/,
    );
  });
});

describe("phone gateway", () => {
  it("rejects an unpaired request and never dials another port", async () => {
    let appHits = 0;
    let decoyHits = 0;
    const decoy = http.createServer((_req, res) => {
      decoyHits += 1;
      res.end("engine");
    });
    const app = http.createServer((req, res) => {
      appHits += 1;
      res.end(String(req.headers.host));
    });
    const decoyPort = await listen(decoy);
    const appPort = await listen(app);
    const gateway = await startPhoneGateway({ host: "127.0.0.1", port: 0, upstreamPort: appPort });
    servers.push(gateway);
    const port = (gateway.address() as AddressInfo).port;

    const unpaired = await fetch(`http://127.0.0.1:${port}/api/generate`, { method: "POST" });
    expect(unpaired.status).toBe(401);
    expect(appHits).toBe(0);
    expect(decoyHits).toBe(0);
    expect(decoyPort).not.toBe(appPort);

    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Pair this phone");
    expect(appHits).toBe(0);
  });

  it("pairs a phone once, then proxies Range requests to the local app only", async () => {
    const invite = rotateInvite();
    let seenHost = "";
    let seenClient = "";
    let seenRange = "";
    const app = http.createServer((req, res) => {
      seenHost = String(req.headers.host);
      seenClient = String(req.headers["x-wavesmith-client"]);
      seenRange = String(req.headers.range);
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

    const bad = await fetch(`http://127.0.0.1:${port}/pair?code=ZZZZ-ZZZZ`, { redirect: "manual" });
    expect(bad.status).toBe(403);

    const paired = await fetch(`http://127.0.0.1:${port}/pair?code=${encodeURIComponent(invite.code)}`, {
      redirect: "manual",
    });
    expect(paired.status).toBe(302);
    const cookie = paired.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("ws_device=");

    const reused = await fetch(`http://127.0.0.1:${port}/pair?code=${encodeURIComponent(invite.code)}`, {
      redirect: "manual",
    });
    expect(reused.status).toBe(403);

    const audio = await fetch(`http://127.0.0.1:${port}/api/audio/demo.mp3`, {
      headers: { cookie: cookie.split(";")[0] ?? "", Range: "bytes=0-3" },
    });
    expect(audio.status).toBe(206);
    expect(await audio.text()).toBe("abcd");
    expect(seenHost).toBe(`127.0.0.1:${appPort}`);
    expect(seenClient).toBe("phone");
    expect(seenRange).toBe("bytes=0-3");
  });
});

describe("phone API secrets", () => {
  it("does not send the xAI key to a phone, or accept one from a phone", async () => {
    const secret = "xai-test-key-should-not-leak";
    saveGrokApiKey(secret);
    const mac = await settingsGET(new Request("http://127.0.0.1/api/settings"));
    expect(await mac.text()).not.toContain(secret);

    const denied = await settingsPATCH(
      new Request("http://127.0.0.1/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", [PHONE_CLIENT_HEADER]: "phone" },
        body: JSON.stringify({ xaiApiKey: "typed-on-the-phone" }),
      }),
    );
    expect(denied.status).toBe(403);
    expect(readGrokApiKey().key).toBe(secret);

    const invite = rotateInvite();
    const phone = await phoneGET(
      new Request("http://127.0.0.1/api/phone", { headers: { [PHONE_CLIENT_HEADER]: "phone" } }),
    );
    const body = (await phone.json()) as { invite: unknown; urls: string[] };
    expect(body.invite).toBeNull();
    expect(body.urls).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(invite.code);

    const blocked = await phonePOST(
      new Request("http://127.0.0.1/api/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json", [PHONE_CLIENT_HEADER]: "phone" },
        body: JSON.stringify({ action: "disable" }),
      }),
    );
    expect(blocked.status).toBe(403);
  });
});
