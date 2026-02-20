import { beforeAll, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";

/**
 * Global test setup
 * This file is automatically loaded by Vitest
 */

// Initialize database schema once before all tests
beforeAll(async () => {
  // Create phrases table
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS phrases (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      source_text TEXT,
      transliteration TEXT,
      translation TEXT,
      grammar_notes TEXT,
      vocab_breakdown TEXT,
      detected_language TEXT,
      language_confidence REAL,
      source_type TEXT,
      audio_url TEXT,
      original_file_url TEXT,
      status TEXT DEFAULT 'processing',
      exclude_from_export INTEGER DEFAULT 0,
      job_started_at INTEGER,
      job_attempts INTEGER DEFAULT 0,
      last_error TEXT,
      current_job_id TEXT,
      processing_step TEXT,
      created_at INTEGER,
      reviewed_at INTEGER,
      exported_at INTEGER
    )
  `).run();

  // Create indexes
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_phrases_status ON phrases(status)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_phrases_created ON phrases(created_at)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_phrases_export ON phrases(status, exclude_from_export)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_phrases_user ON phrases(user_id)`).run();
});

// Clear database between tests
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM phrases").run();
});

afterEach(async () => {
  // Cleanup after each test
});

/**
 * Helper to get current timestamp in seconds (for signature expiry)
 */
export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Helper to wait for a condition with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeout) {
      throw new Error("Timeout waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
