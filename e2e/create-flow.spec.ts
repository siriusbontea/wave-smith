/**
 * e2e/create-flow.spec.ts — the M3 smoke (spec §12 M3 gate): full forge flow
 * from the browser produces variations in the library; Generate Lyrics inserts
 * editable lyrics. Mock mode: instant canned engine + lyrics.
 */
import { expect, test } from "@playwright/test";
import { dismissTourIfPresent } from "./helpers";

test("forge flow: prompt → preset → forge → queue → library shows variations", async ({
  page,
}) => {
  await page.goto("/");
  await dismissTourIfPresent(page);

  // Hero + presets render.
  await expect(page.getByTestId("prompt-input")).toBeVisible();
  await expect(page.getByTestId("preset")).toHaveCount(6);

  // A preset fills the prompt.
  await page.getByTestId("preset").first().click();
  await expect(page.getByTestId("prompt-input")).not.toHaveValue("");

  // Forge (default 2 variations).
  await page.getByTestId("forge").click();

  // Queue strip appears and reaches success (mock engine: a few polls).
  await expect(page.getByTestId("queue-strip")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("job-succeeded")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("job-succeeded")).toContainText("2 takes");

  // Library lists both takes; play via global mini-player (M4 — no per-row audio).
  await page.goto("/library");
  await expect(page.getByTestId("song-item")).toHaveCount(2);
  await page.getByTestId("play-button").first().click();
  await expect(page.getByTestId("mini-player")).toBeVisible();

  const href = await page.getByTestId("mini-player").locator("a").getAttribute("href");
  expect(href).toMatch(/^\/library\//);
  const audioRes = await page.request.get(`/api/songs`);
  expect(audioRes.status()).toBe(200);
});

test("Generate Lyrics inserts editable lyrics into the Advanced editor", async ({ page }) => {
  await page.goto("/");
  await dismissTourIfPresent(page);
  await page.getByTestId("prompt-input").fill("a song about test coverage");
  await page.getByTestId("advanced-tab").click();

  // Mock lyrics client is always available → button visible.
  await page.getByTestId("generate-lyrics").click();
  const lyricsBox = page.getByTestId("lyrics-input");
  await expect(lyricsBox).toHaveValue(/\[verse\]/, { timeout: 10_000 });
  await expect(lyricsBox).toHaveValue(/\[chorus\]/);

  // Editable: the user can refine before forging.
  await lyricsBox.fill("[verse]\nMy own edited line");
  await expect(lyricsBox).toHaveValue("[verse]\nMy own edited line");
});

test("Enhance populates the Advanced fields from the plan", async ({ page }) => {
  await page.goto("/");
  await dismissTourIfPresent(page);
  await page.getByTestId("prompt-input").fill("minimal techno");
  await page.getByTestId("advanced-tab").click();
  await page.getByTestId("enhance").click();

  // Mock enhance returns an enriched caption + metadata.
  await expect(page.getByTestId("prompt-input")).toHaveValue(/detailed mock caption/, {
    timeout: 10_000,
  });
  await expect(page.locator("#bpm")).toHaveValue("120");
});
