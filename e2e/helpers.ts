/** Dismiss the first-run onboarding overlay via API (reliable in parallel e2e). */
import { Page } from "@playwright/test";

export async function dismissTourIfPresent(page: Page) {
  await page.request.patch("/api/settings", {
    data: { onboardingComplete: true },
    headers: {
      "Content-Type": "application/json",
      "x-wavesmith-request": "1",
      Origin: "http://127.0.0.1:3100",
    },
  });
}
