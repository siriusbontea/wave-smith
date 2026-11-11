/**
 * e2e/phone-forge.spec.ts — a paired phone on plain HTTP can forge.
 *
 * crypto.randomUUID is missing when the page is not a secure context.
 * 172.30.x over the gateway is that page. The click has to reach POST
 * /api/generate and get 202.
 */
import http from "node:http";
import os from "node:os";
import { expect, test } from "@playwright/test";
import { dismissTourIfPresent } from "./helpers";

function phoneHost(): string {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family as string | number;
      if (entry.internal || (family !== "IPv4" && family !== 4)) continue;
      if (entry.address.startsWith("127.")) continue;
      return entry.address;
    }
  }
  throw new Error("This machine has no non-loopback IPv4 address.");
}

function macHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-wavesmith-request": "1",
    Origin: "http://127.0.0.1:3100",
  };
}

function statusOf(path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: 3100, path, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });
}

test("a forged X-Forwarded-For is not treated as the Mac", async () => {
  const status = await statusOf("/api/songs", { "x-forwarded-for": "100.101.1.2" });
  expect(status).toBe(403);
});

test("a paired phone forges from a non-loopback HTTP page", async ({ page, request }) => {
  await dismissTourIfPresent(page);
  const enabled = await request.post("/api/phone", {
    data: { action: "enable" },
    headers: macHeaders(),
  });
  expect(enabled.ok()).toBe(true);
  const lan = await request.post("/api/phone", {
    data: { action: "lan-on" },
    headers: macHeaders(),
  });
  expect(lan.ok()).toBe(true);
  const status = await request.get("/api/phone");
  const body = (await status.json()) as {
    listening: boolean;
    error: string | null;
    port: number;
    invite: { code: string } | null;
  };
  expect(body.listening, body.error ?? "phone door closed").toBe(true);
  expect(body.invite?.code).toBeTruthy();

  const host = phoneHost();
  const origin = `http://${host}:${body.port}`;
  await page.goto(`${origin}/pair`);
  const context = await page.evaluate(() => ({
    secure: window.isSecureContext,
    randomUUID: typeof crypto.randomUUID,
  }));
  expect(context.secure).toBe(false);
  expect(context.randomUUID).toBe("undefined");

  await page.locator("input[name=code]").fill(body.invite!.code);
  await page.getByRole("button", { name: "Pair" }).click();
  await page.waitForURL(`${origin}/`);

  await page.getByTestId("prompt-input").fill("a short song from the phone");
  const forged = page.waitForResponse(
    (res) => res.url().includes("/api/generate") && res.request().method() === "POST",
  );
  await page.getByTestId("forge").click();
  expect((await forged).status()).toBe(202);

  await request.post("/api/phone", { data: { action: "disable" }, headers: macHeaders() });
});
