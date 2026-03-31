import { test, expect } from "@playwright/test";

// Mock API responses so tests don't depend on a live worker with real auth.
// The worker has its own unit test suite; these are UI smoke tests only.
async function mockApi(page: Parameters<typeof test>[1] extends { page: infer P } ? P : never) {
  await page.route("/api/settings", (route) =>
    route.fulfill({
      json: {
        llm_provider: null,
        llm_model: null,
        llm_api_key_mask: null,
        daily_llm_usage: 0,
        daily_llm_limit: 10,
      },
    }),
  );

  await page.route("/api/phrases*", (route) =>
    route.fulfill({ json: { phrases: [], total: 0 } }),
  );

  await page.route("/api/upload/text", (route) =>
    route.fulfill({
      status: 202,
      json: { id: "test-phrase-id", status: "processing" },
    }),
  );

  await page.route("/api/upload/sign*", (route) =>
    route.fulfill({
      json: { upload_url: "https://example.com/upload", phrase_id: "test-id" },
    }),
  );
}

test.describe("Critical User Flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("text upload → review → approve → export", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Should show Capture page by default
    await expect(page.locator("h1")).toContainText("Capture");

    // Select Text input mode
    await page.click('button:has-text("Text")');

    // Select Russian language
    await page.click('button:has-text("Russian")');

    // Enter test phrase
    await page.fill('textarea[placeholder*="Type or paste"]', "Привет, как дела?");

    // Submit (mocked → 202)
    await page.click('button:has-text("Submit")');

    // Should show success/processing message
    await expect(page.locator("text=/Processing started|Check Review/i")).toBeVisible({
      timeout: 10000,
    });

    // Navigate to Review page
    await page.click('a:has-text("Review")');
    await expect(page.locator("h1")).toContainText("Review");
    await expect(page.locator("text=/\\d+ phrases? pending review/i")).toBeVisible();

    // Navigate to Library
    await page.click('a:has-text("Library")');
    await expect(page.locator("h1")).toContainText("Library");
    await expect(page.locator('button:has-text("all")')).toBeVisible();

    // Navigate to Export
    await page.click('a:has-text("Export")');
    await expect(page.locator("h1")).toContainText("Export");
    await expect(page.locator("text=/Import Instructions/i")).toBeVisible();
  });

  test("navigation between pages works", async ({ page }) => {
    await page.goto("/");

    const pages = [
      { link: "Upload", heading: "Capture" },
      { link: "Review", heading: "Review" },
      { link: "Library", heading: "Library" },
      { link: "Export", heading: "Export" },
    ];

    for (const { link, heading } of pages) {
      await page.click(`a:has-text("${link}")`);
      await expect(page.locator("h1")).toContainText(heading);
    }
  });

  test("upload form validation works", async ({ page }) => {
    await page.goto("/");

    // Click Text mode
    await page.click('button:has-text("Text")');
    await page.fill('textarea[placeholder*="Type or paste"]', "Test");

    // Should have language buttons
    await expect(page.locator('button:has-text("Russian")')).toBeVisible();
    await expect(page.locator('button:has-text("Arabic")')).toBeVisible();
    await expect(page.locator('button:has-text("Chinese")')).toBeVisible();
    await expect(page.locator('button:has-text("Spanish")')).toBeVisible();

    // Should have Submit button
    await expect(page.locator('button[type="submit"]:has-text("Submit")')).toBeVisible();
  });

  test("review page shows empty state when no phrases", async ({ page }) => {
    await page.goto("/review");

    await expect(page.locator("h1")).toContainText("Review");
    await expect(page.locator("text=/\\d+ phrases? pending review/i")).toBeVisible();
    await expect(page.locator('button:has-text("Refresh")')).toBeVisible();
  });

  test("library page filters work", async ({ page }) => {
    await page.goto("/library");

    await page.click('button:has-text("all")');
    await expect(page.locator('button:has-text("all")')).toHaveClass(/bg-zinc-800/);

    await page.click('button:has-text("processing")');
    await expect(page.locator('button:has-text("processing")')).toHaveClass(/bg-zinc-800/);

    await page.click('button:has-text("approved")');
    await expect(page.locator('button:has-text("approved")')).toHaveClass(/bg-zinc-800/);
  });

  test("health check endpoint works", async ({ request }) => {
    const response = await request.get("http://localhost:8787/api/health");
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.db).toBe(true);
    expect(data.r2).toBe(true);
  });
});
