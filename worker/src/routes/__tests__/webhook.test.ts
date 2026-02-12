import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";
import {
  createMockWebhookPayload,
  createMockWebhookError,
  randomId,
} from "../../__tests__/factories";

describe("Modal Webhook Handler", () => {
  describe("Authentication", () => {
    it("rejects requests without Authorization header", async () => {
      const response = await SELF.fetch("http://example.com/api/webhook/modal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase_id: "test-123" }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("rejects requests with invalid secret", async () => {
      const response = await SELF.fetch("http://example.com/api/webhook/modal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer WRONG-SECRET",
        },
        body: JSON.stringify({ phrase_id: "test-123" }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("accepts requests with valid secret", async () => {
      const phraseId = randomId("phrase");

      // Create a phrase in processing state
      await env.DB.prepare(`
        INSERT INTO phrases (id, user_id, source_type, status, created_at, job_attempts)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(phraseId, "test-user", "text", "processing", Date.now(), 0).run();

      const payload = createMockWebhookPayload(phraseId);

      const response = await SELF.fetch("http://example.com/api/webhook/modal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-webhook-secret",
        },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.received).toBe(true);
    });
  });

  describe("Payload Validation", () => {
    it("rejects payload without phrase_id", async () => {
      const response = await SELF.fetch("http://example.com/api/webhook/modal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-webhook-secret",
        },
        body: JSON.stringify({ success: true }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Missing phrase_id");
    });

    it("returns 404 for non-existent phrase", async () => {
      const payload = createMockWebhookPayload("non-existent-phrase-id");

      const response = await SELF.fetch("http://example.com/api/webhook/modal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-webhook-secret",
        },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Phrase not found");
    });
  });

  describe("Successful Processing", () => {
    it("updates phrase with processing results", async () => {
      const phraseId = randomId("phrase");

      // Create phrase in processing state
      await env.DB.prepare(`
        INSERT INTO phrases (id, user_id, source_type, status, created_at, job_attempts)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(phraseId, "test-user", "text", "processing", Date.now(), 0).run();

      const payload = createMockWebhookPayload(phraseId, {
        result: {
          source_text: "Привет, мир!",
          transliteration: "Privet, mir!",
          translation: "Hello, world!",
          grammar_notes: "Common Russian greeting",
          vocab_breakdown: [
            {
              word: "Привет",
              root: null,
              meaning: "Hello",
              gender: null,
              declension: null,
              notes: "Informal greeting",
            },
          ],
          detected_language: "ru",
          language_confidence: 0.99,
          audio_url: `audio/${phraseId}.mp3`,
        },
      });

      const response = await SELF.fetch("http://example.com/api/webhook/modal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-webhook-secret",
        },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);

      // Verify phrase was updated
      const updated = await env.DB.prepare(
        "SELECT * FROM phrases WHERE id = ?"
      )
        .bind(phraseId)
        .first();

      expect(updated.status).toBe("pending_review");
      expect(updated.source_text).toBe("Привет, мир!");
      expect(updated.translation).toBe("Hello, world!");
      expect(updated.transliteration).toBe("Privet, mir!");
      expect(updated.detected_language).toBe("ru");
      expect(updated.language_confidence).toBe(0.99);
      expect(updated.audio_url).toBe(`audio/${phraseId}.mp3`);
      expect(updated.last_error).toBeNull();

      // Verify vocab breakdown was stored as JSON
      const vocab = JSON.parse(updated.vocab_breakdown);
      expect(vocab).toHaveLength(1);
      expect(vocab[0].word).toBe("Привет");
      expect(vocab[0].meaning).toBe("Hello");
    });

    it("clears previous error on successful processing", async () => {
      const phraseId = randomId("phrase");

      // Create phrase with previous error
      await env.DB.prepare(`
        INSERT INTO phrases (id, user_id, source_type, status, created_at, job_attempts, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        phraseId,
        "test-user",
        "text",
        "processing",
        Date.now(),
        1,
        "Previous OCR failure"
      ).run();

      const payload = createMockWebhookPayload(phraseId);

      await SELF.fetch("http://example.com/api/webhook/modal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-webhook-secret",
        },
        body: JSON.stringify(payload),
      });

      const updated = await env.DB.prepare(
        "SELECT * FROM phrases WHERE id = ?"
      )
        .bind(phraseId)
        .first();

      expect(updated.last_error).toBeNull();
      expect(updated.status).toBe("pending_review");
    });
  });

  describe("Failed Processing", () => {
    it("records error and moves to pending_review", async () => {
      const phraseId = randomId("phrase");

      await env.DB.prepare(`
        INSERT INTO phrases (id, user_id, source_type, status, created_at, job_attempts)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(phraseId, "test-user", "image", "processing", Date.now(), 1).run();

      const payload = createMockWebhookError(
        phraseId,
        "OCR failed: unsupported language"
      );

      const response = await SELF.fetch("http://example.com/api/webhook/modal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-webhook-secret",
        },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);

      const updated = await env.DB.prepare(
        "SELECT * FROM phrases WHERE id = ?"
      )
        .bind(phraseId)
        .first();

      expect(updated.status).toBe("pending_review");
      expect(updated.last_error).toBe("OCR failed: unsupported language");
      expect(updated.grammar_notes).toContain("Processing error");
      expect(updated.grammar_notes).toContain("OCR failed");
    });
  });
});
