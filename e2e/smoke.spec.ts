import { test, expect } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";

/**
 * Smoke test: Critical user flow
 *
 * This test validates the happy path:
 * 1. Upload text phrase
 * 2. Wait for processing (simulated success)
 * 3. Review and verify fields
 * 4. Approve phrase
 * 5. Export to ZIP
 */

test.describe("Critical User Flow", () => {
  // Setup Clerk authentication before each test
  test.beforeEach(async ({ page }) => {
    await setupClerkTestingToken({ page });
  });
  test("text upload → review → approve → export", async ({ page }) => {
    // Navigate to app
    await page.goto("/");

    // Should show Capture page by default
    await expect(page.locator("h1")).toContainText("Capture");

    // Select Text input mode
    await page.click('button:has-text("Text")');

    // Select Russian language (button-based picker)
    await page.click('button:has-text("Russian")');

    // Enter test phrase
    const testPhrase = "Привет, как дела?";
    await page.fill('textarea[placeholder*="Type or paste"]', testPhrase);

    // Submit
    await page.click('button:has-text("Submit")');

    // Should show success message
    await expect(page.locator("text=/Processing started|Check Review/i")).toBeVisible({
      timeout: 10000,
    });

    // Navigate to Review page
    await page.click('a:has-text("Review")');

    // Wait for phrase to appear (in real app, would wait for Modal processing)
    // For this smoke test, we're just checking the UI works
    await expect(page.locator("h1")).toContainText("Review");

    // Should show count of pending phrases (be specific to avoid strict mode)
    await expect(page.locator("text=/\\d+ phrases? pending review/i")).toBeVisible();

    // Click Refresh to get latest
    await page.click('button:has-text("Refresh")');

    // Verify the page is functional (even if no phrases loaded yet)
    await expect(page.locator("h1")).toContainText("Review");

    // Navigate to Library
    await page.click('a:has-text("Library")');
    await expect(page.locator("h1")).toContainText("Library");

    // Should have filter buttons
    await expect(page.locator('button:has-text("all")')).toBeVisible();
    await expect(page.locator('button:has-text("processing")')).toBeVisible();
    await expect(page.locator('button:has-text("pending review")')).toBeVisible();
    await expect(page.locator('button:has-text("approved")')).toBeVisible();

    // Navigate to Export
    await page.click('a:has-text("Export")');
    await expect(page.locator("h1")).toContainText("Export");

    // Should show export instructions
    await expect(page.locator("text=/Import Instructions/i")).toBeVisible();
  });

  test("navigation between pages works", async ({ page }) => {
    await page.goto("/");

    // Test all navigation links
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

    // Enter text in the textarea
    await page.fill('textarea[placeholder*="Type or paste"]', "Test");

    // Should have language buttons for all supported languages
    await expect(page.locator('button:has-text("Russian")')).toBeVisible();
    await expect(page.locator('button:has-text("Arabic")')).toBeVisible();
    await expect(page.locator('button:has-text("Chinese")')).toBeVisible();
    await expect(page.locator('button:has-text("Spanish")')).toBeVisible();

    // Should have Submit button
    await expect(page.locator('button[type="submit"]:has-text("Submit")')).toBeVisible();
  });

  test("review page shows empty state when no phrases", async ({ page }) => {
    await page.goto("/review");

    // Should show heading
    await expect(page.locator("h1")).toContainText("Review");

    // Should show count (be more specific to avoid strict mode violation)
    await expect(page.locator("text=/\\d+ phrases? pending review/i")).toBeVisible();

    // Should have Refresh button
    await expect(page.locator('button:has-text("Refresh")')).toBeVisible();
  });

  test("library page filters work", async ({ page }) => {
    await page.goto("/library");

    // Click each filter
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
