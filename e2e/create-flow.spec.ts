/**
 * e2e/create-flow.spec.ts — the M3 smoke (spec §12 M3 gate): full forge flow
 * from the browser produces variations in the library; Generate Lyrics inserts
 * editable lyrics. Mock mode: instant canned engine + lyrics.
 */
import { expect, test } from "@playwright/test";

test("forge flow: prompt → preset → forge → queue → library shows variations", async ({
  page,
}) => {
  await page.goto("/");

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

  // Library lists both takes with audio elements wired to /api/audio.
  await page.goto("/library");
  await expect(page.getByTestId("song-item")).toHaveCount(2);
  const src = await page.locator("audio").first().getAttribute("src");
  expect(src).toMatch(/^\/api\/audio\//);

  // The audio actually serves (the library uses preload="none", so without
  // this the serving seam would have zero e2e coverage).
  const audioRes = await page.request.get(src!);
  expect(audioRes.status()).toBe(200);
  expect((await audioRes.body()).length).toBeGreaterThan(10_000);
  expect(audioRes.headers()["content-type"]).toBe("audio/mpeg");
});

test("Generate Lyrics inserts editable lyrics into the Advanced editor", async ({ page }) => {
  await page.goto("/");
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
  await page.getByTestId("prompt-input").fill("minimal techno");
  await page.getByTestId("advanced-tab").click();
  await page.getByTestId("enhance").click();

  // Mock enhance returns an enriched caption + metadata.
  await expect(page.getByTestId("prompt-input")).toHaveValue(/detailed mock caption/, {
    timeout: 10_000,
  });
  await expect(page.locator("#bpm")).toHaveValue("120");
});
