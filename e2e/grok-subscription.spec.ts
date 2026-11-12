/**
 * Settings can select Grok subscription without turning on the API-key hybrid.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("settings offers Grok subscription and keeps the API-key mode separate", async ({ page }) => {
  await page.goto("/settings");
  await page.getByTestId("connection-mode").click();
  await page.getByRole("option", { name: "Grok subscription (via Grok Build)" }).click();
  const panel = page.getByTestId("grok-subscription");
  await expect(panel).toContainText("weekly usage pool");
  await expect(panel).toContainText("grok login");
  await expect(panel).toContainText("xAI API key is not used");
  await expect(page.getByTestId("grok-usage")).toContainText("today");
  await expect(page.getByTestId("grok-usage")).toContainText("doctor --deep");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  const cloudArtifacts = "/opt/cursor/artifacts";
  const shotDir = fs.existsSync(cloudArtifacts) ? cloudArtifacts : path.join(process.cwd(), "test-results");
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({
    path: path.join(shotDir, "grok-subscription-settings.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId("connection-mode").click();
  await page.getByRole("option", { name: "Local only" }).click();
  await expect(panel).toHaveCount(0);

  await page.getByTestId("connection-mode").click();
  await page.getByRole("option", { name: "Grok hybrid" }).click();
  await expect(page.getByLabel("xAI API key")).toBeVisible();
  await expect(panel).toHaveCount(0);
});
