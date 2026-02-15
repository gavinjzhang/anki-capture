import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { handleRegenerateAudio, handleRetryPhrase } from "../phrases";
import { createPhrase, updatePhraseForUser, getPhraseForUser } from "../../lib/db";
import { randomId } from "../../__tests__/factories";
import type { Env } from "../../types";
import * as modal from "../../lib/modal";

/**
 * Audio Regeneration and Retry Routes Tests
 *
 * Tests phrase regeneration and retry endpoints including:
 * - Regenerate audio (with/without text override)
 * - Retry phrase (job queuing, state transitions)
 * - Rate limiting
 * - User isolation
 * - Error handling
 */

describe("Regenerate and Retry Routes", () => {
  const userAlice = "user-alice";
  const userBob = "user-bob";

  let triggerProcessingMock: ReturnType<typeof vi.fn>;
  let buildFileUrlMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    env.ENVIRONMENT = "development"; // Disable rate limiting

    triggerProcessingMock = vi.fn().mockResolvedValue(undefined);
    buildFileUrlMock = vi.fn((env: Env, url: URL, key: string) =>
      Promise.resolve(`https://test.com/files/${key}`)
    );

    vi.spyOn(modal, "triggerProcessing").mockImplementation(triggerProcessingMock);
    vi.spyOn(modal, "buildFileUrl").mockImplementation(buildFileUrlMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createAuthRequest(
    url: string,
    userId: string,
    options: RequestInit = {}
  ): Request {
    return new Request(url, {
      ...options,
      headers: {
        ...options.headers,
        "x-user": userId,
        "x-request-id": crypto.randomUUID(),
      },
    });
  }

  describe("handleRegenerateAudio", () => {
    it("regenerates audio for existing phrase", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Привет", "ru");
      await updatePhraseForUser(env, userAlice, phraseId, {
        audio_url: `${userAlice}/audio/${phraseId}.mp3`,
      });

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/regenerate-audio`,
        userAlice,
        { method: "POST" }
      );

      const response = await handleRegenerateAudio(request, env, phraseId);
      const data = (await response.json()) as { message: string };

      expect(response.status).toBe(200);
      expect(data.message).toBe("Audio regeneration triggered");

      // Verify triggerProcessing was called with audio_only flag
      expect(triggerProcessingMock).toHaveBeenCalledWith(
        env,
        expect.objectContaining({
          phrase_id: phraseId,
          source_type: "text",
          source_text: "Привет",
          language: "ru",
          audio_only: true,
        }),
        expect.any(URL)
      );
    });

    it("regenerates audio with custom text override", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Original text", "ru");

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/regenerate-audio`,
        userAlice,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_text: "Custom text" }),
        }
      );

      const response = await handleRegenerateAudio(request, env, phraseId);

      expect(response.status).toBe(200);
      expect(triggerProcessingMock).toHaveBeenCalledWith(
        env,
        expect.objectContaining({
          source_text: "Custom text",
          audio_only: true,
        }),
        expect.any(URL)
      );
    });

    it("regenerates audio with custom language", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "مرحبا", "ar");

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/regenerate-audio`,
        userAlice,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: "ar" }),
        }
      );

      const response = await handleRegenerateAudio(request, env, phraseId);

      expect(response.status).toBe(200);
      expect(triggerProcessingMock).toHaveBeenCalledWith(
        env,
        expect.objectContaining({
          language: "ar",
          audio_only: true,
        }),
        expect.any(URL)
      );
    });

    it("regenerates audio with both text and language overrides", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Old text", "ru");

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/regenerate-audio`,
        userAlice,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_text: "新文本", language: "zh" }),
        }
      );

      const response = await handleRegenerateAudio(request, env, phraseId);

      expect(response.status).toBe(200);
      expect(triggerProcessingMock).toHaveBeenCalledWith(
        env,
        expect.objectContaining({
          source_text: "新文本",
          language: "zh",
          audio_only: true,
        }),
        expect.any(URL)
      );
    });

    it("returns 404 for phrase owned by different user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's phrase", "ru");

      // Bob tries to regenerate Alice's audio
      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/regenerate-audio`,
        userBob,
        { method: "POST" }
      );

      const response = await handleRegenerateAudio(request, env, phraseId);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe("Phrase not found");
    });

    it("returns 400 when phrase has no source text", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "", "ru");
      await updatePhraseForUser(env, userAlice, phraseId, { source_text: null });

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/regenerate-audio`,
        userAlice,
        { method: "POST" }
      );

      const response = await handleRegenerateAudio(request, env, phraseId);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe("No source text to generate audio from");
    });

    it("sets current_job_id when regenerating", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/regenerate-audio`,
        userAlice,
        { method: "POST" }
      );

      await handleRegenerateAudio(request, env, phraseId);

      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.current_job_id).toBeTruthy();
      expect(phrase!.job_attempts).toBeGreaterThan(0);
    });

    it("handles empty JSON body gracefully", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/regenerate-audio`,
        userAlice,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      const response = await handleRegenerateAudio(request, env, phraseId);

      expect(response.status).toBe(200);
      // Should use phrase's existing source_text and language
      expect(triggerProcessingMock).toHaveBeenCalledWith(
        env,
        expect.objectContaining({
          source_text: "Test",
          language: "ru",
        }),
        expect.any(URL)
      );
    });
  });

  describe("handleRetryPhrase", () => {
    it("retries failed phrase", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");
      await updatePhraseForUser(env, userAlice, phraseId, {
        status: "failed",
        last_error: "Previous error",
      });

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/retry`,
        userAlice,
        { method: "POST" }
      );

      const response = await handleRetryPhrase(request, env, phraseId);
      const data = (await response.json()) as { message: string; status: string };

      expect(response.status).toBe(200);
      expect(data.message).toBe("Retry queued");
      expect(data.status).toBe("processing");

      // Verify status changed to processing
      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.status).toBe("processing");
      expect(phrase!.current_job_id).toBeTruthy();
    });

    it("increments job_attempts on retry", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");
      await updatePhraseForUser(env, userAlice, phraseId, { job_attempts: 2 });

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/retry`,
        userAlice,
        { method: "POST" }
      );

      await handleRetryPhrase(request, env, phraseId);

      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.job_attempts).toBe(3);
    });

    it("reuses existing file URL for file-based phrases", async () => {
      const phraseId = randomId("phrase");
      const fileUrl = `${userAlice}/original/${phraseId}.mp3`;
      await createPhrase(env, userAlice, phraseId, "audio", fileUrl, null, "ru");

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/retry`,
        userAlice,
        { method: "POST" }
      );

      await handleRetryPhrase(request, env, phraseId);

      expect(triggerProcessingMock).toHaveBeenCalledWith(
        env,
        expect.objectContaining({
          phrase_id: phraseId,
          source_type: "audio",
          file_url: expect.stringContaining(fileUrl),
        }),
        expect.any(URL)
      );
    });

    it("uses source_text for text-based phrases", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test text", "ru");

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/retry`,
        userAlice,
        { method: "POST" }
      );

      await handleRetryPhrase(request, env, phraseId);

      expect(triggerProcessingMock).toHaveBeenCalledWith(
        env,
        expect.objectContaining({
          phrase_id: phraseId,
          source_type: "text",
          source_text: "Test text",
          file_url: null,
        }),
        expect.any(URL)
      );
    });

    it("returns 404 for phrase owned by different user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's phrase", "ru");

      // Bob tries to retry Alice's phrase
      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/retry`,
        userBob,
        { method: "POST" }
      );

      const response = await handleRetryPhrase(request, env, phraseId);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe("Phrase not found");
    });

    it("can retry phrase in any status", async () => {
      const statuses: Array<"processing" | "pending_review" | "approved" | "failed"> = [
        "processing",
        "pending_review",
        "approved",
        "failed",
      ];

      for (const status of statuses) {
        const phraseId = randomId("phrase");
        await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");
        await updatePhraseForUser(env, userAlice, phraseId, { status });

        const request = createAuthRequest(
          `http://test.com/api/phrases/${phraseId}/retry`,
          userAlice,
          { method: "POST" }
        );

        const response = await handleRetryPhrase(request, env, phraseId);

        expect(response.status).toBe(200);
      }
    });

    it("sets job_started_at timestamp", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");

      const beforeRetry = Date.now();

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/retry`,
        userAlice,
        { method: "POST" }
      );

      await handleRetryPhrase(request, env, phraseId);

      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.job_started_at).toBeTruthy();
      expect(phrase!.job_started_at).toBeGreaterThanOrEqual(beforeRetry);
    });
  });

  describe("Multi-Tenant Isolation", () => {
    it("isolates regenerate operations between users", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's phrase", "ru");

      // Bob cannot regenerate Alice's audio
      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/regenerate-audio`,
        userBob,
        { method: "POST" }
      );

      const response = await handleRegenerateAudio(request, env, phraseId);

      expect(response.status).toBe(404);
      expect(triggerProcessingMock).not.toHaveBeenCalled();
    });

    it("isolates retry operations between users", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's phrase", "ru");

      // Bob cannot retry Alice's phrase
      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/retry`,
        userBob,
        { method: "POST" }
      );

      const response = await handleRetryPhrase(request, env, phraseId);

      expect(response.status).toBe(404);
      expect(triggerProcessingMock).not.toHaveBeenCalled();
    });
  });
});
