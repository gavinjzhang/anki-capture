import { clerkSetup } from "@clerk/testing/playwright";

/**
 * Global setup for Playwright tests
 * Configures Clerk authentication for E2E tests
 */
export default async function globalSetup() {
  await clerkSetup();
}
