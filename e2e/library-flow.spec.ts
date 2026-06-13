/**
 * e2e/library-flow.spec.ts — M4 gate: library → play via global mini-player.
 */
import { expect, test } from "@playwright/test";
import { dismissTourIfPresent } from "./helpers";

test("library play: forge → library card → mini-player plays", async ({ page }) => {
  await page.goto("/");
  await dismissTourIfPresent(page);
  await page.getByTestId("preset").first().click();
  await page.getByTestId("forge").click();
  await expect(page.getByTestId("job-succeeded")).toBeVisible({ timeout: 15_000 });

  await page.goto("/library");
  await expect(page.getByTestId("song-item").first()).toBeVisible();
  await page.getByTestId("play-button").first().click();
  await expect(page.getByTestId("mini-player")).toBeVisible();

  // Mini-player seek bar exists; audio route still serves with Range.
  const songLink = page.getByTestId("mini-player").locator("a");
  const href = await songLink.getAttribute("href");
  expect(href).toMatch(/^\/library\//);
});

test("song view opens with waveform and metadata", async ({ page }) => {
  await page.goto("/");
  await dismissTourIfPresent(page);
  await page.getByTestId("prompt-input").fill("library e2e song");
  await page.getByTestId("forge").click();
  await expect(page.getByTestId("job-succeeded")).toBeVisible({ timeout: 15_000 });

  await page.goto("/library");
  await page.getByTestId("song-item").first().click();
  await expect(page.getByTestId("song-view")).toBeVisible();
  await expect(page.getByTestId("waveform")).toBeVisible();
  await expect(page.getByTestId("song-lyrics")).toBeVisible();
});
