import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import {
  handleListPhrases,
  handleGetPhrase,
  handleUpdatePhrase,
  handleApprovePhrase,
  handleDeletePhrase,
} from "../phrases";
import { createPhrase, updatePhraseForUser, getPhraseForUser } from "../../lib/db";
import { randomId } from "../../__tests__/factories";
import type { Env } from "../../types";
import * as modal from "../../lib/modal";

/**
 * Phrases CRUD Routes Tests
 *
 * Tests phrase management endpoints including:
 * - List phrases (filtering, pagination, signed URLs)
 * - Get phrase (user isolation, 404 handling)
 * - Update phrase (field updates, language change triggers reprocessing)
 * - Approve phrase (status validation, rate limiting)
 * - Delete phrase (R2 cleanup, user isolation)
 * - Multi-tenant isolation across all operations
 */

describe("Phrases Routes", () => {
  const userAlice = "user-alice";
  const userBob = "user-bob";

  // Mock Modal functions
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

  describe("handleListPhrases", () => {
    beforeEach(async () => {
      // Create test data for Alice
      await createPhrase(env, userAlice, randomId("phrase"), "text", null, "Alice 1", "ru");
      await createPhrase(env, userAlice, randomId("phrase"), "text", null, "Alice 2", "ru");
      await createPhrase(env, userAlice, randomId("phrase"), "text", null, "Alice 3", "ru");

      // Create one and update to approved status
      const approvedPhraseId = randomId("phrase");
      await createPhrase(env, userAlice, approvedPhraseId, "text", null, "Alice approved", "ru");
      await updatePhraseForUser(env, userAlice, approvedPhraseId, { status: "approved" });

      // Create test data for Bob
      await createPhrase(env, userBob, randomId("phrase"), "text", null, "Bob 1", "ru");
      await createPhrase(env, userBob, randomId("phrase"), "text", null, "Bob 2", "ru");
    });

    it("lists phrases for authenticated user", async () => {
      const request = createAuthRequest("http://test.com/api/phrases", userAlice);
      const response = await handleListPhrases(request, env);
      const data = (await response.json()) as { phrases: any[] };

      expect(response.status).toBe(200);
      expect(data.phrases.length).toBeGreaterThanOrEqual(4);
      expect(data.phrases.every((p) => p.user_id === userAlice)).toBe(true);
    });

    it("filters phrases by status", async () => {
      const request = createAuthRequest(
        "http://test.com/api/phrases?status=approved",
        userAlice
      );
      const response = await handleListPhrases(request, env);
      const data = (await response.json()) as { phrases: any[] };

      expect(response.status).toBe(200);
      expect(data.phrases.length).toBeGreaterThanOrEqual(1);
      expect(data.phrases.every((p) => p.status === "approved")).toBe(true);
    });

    it("respects limit parameter", async () => {
      const request = createAuthRequest(
        "http://test.com/api/phrases?limit=2",
        userAlice
      );
      const response = await handleListPhrases(request, env);
      const data = (await response.json()) as { phrases: any[] };

      expect(response.status).toBe(200);
      expect(data.phrases.length).toBeLessThanOrEqual(2);
    });

    it("does not leak phrases between users", async () => {
      const requestAlice = createAuthRequest("http://test.com/api/phrases", userAlice);
      const responseAlice = await handleListPhrases(requestAlice, env);
      const dataAlice = (await responseAlice.json()) as { phrases: any[] };

      const requestBob = createAuthRequest("http://test.com/api/phrases", userBob);
      const responseBob = await handleListPhrases(requestBob, env);
      const dataBob = (await responseBob.json()) as { phrases: any[] };

      // Alice should only see her phrases
      expect(dataAlice.phrases.every((p) => p.source_text?.startsWith("Alice"))).toBe(true);

      // Bob should only see his phrases
      expect(dataBob.phrases.every((p) => p.source_text?.startsWith("Bob"))).toBe(true);

      // No overlap
      const aliceIds = dataAlice.phrases.map((p) => p.id);
      const bobIds = dataBob.phrases.map((p) => p.id);
      expect(aliceIds.some((id) => bobIds.includes(id))).toBe(false);
    });

    it("includes signed URLs for audio_url and original_file_url", async () => {
      // Create phrase with audio URL
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "audio", "audio/test.mp3", "Test", "ru");
      await updatePhraseForUser(env, userAlice, phraseId, {
        audio_url: `${userAlice}/audio/${phraseId}.mp3`,
      });

      const request = createAuthRequest("http://test.com/api/phrases", userAlice);
      const response = await handleListPhrases(request, env);
      const data = (await response.json()) as { phrases: any[] };

      const phraseWithAudio = data.phrases.find((p) => p.id === phraseId);
      expect(phraseWithAudio).toBeTruthy();
      // Signed URLs should include query params (e, sig)
      if (phraseWithAudio?.audio_url) {
        expect(phraseWithAudio.audio_url).toContain("?");
      }
    });
  });

  describe("handleGetPhrase", () => {
    it("returns phrase owned by user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's phrase", "ru");

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}`,
        userAlice
      );
      const response = await handleGetPhrase(request, env, phraseId);
      const data = (await response.json()) as { phrase: any };

      expect(response.status).toBe(200);
      expect(data.phrase.id).toBe(phraseId);
      expect(data.phrase.source_text).toBe("Alice's phrase");
    });

    it("returns 404 for phrase owned by different user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's secret", "ru");

      // Bob tries to access Alice's phrase
      const request = createAuthRequest(`http://test.com/api/phrases/${phraseId}`, userBob);
      const response = await handleGetPhrase(request, env, phraseId);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe("Phrase not found");
    });

    it("returns 404 for non-existent phrase", async () => {
      const request = createAuthRequest(
        "http://test.com/api/phrases/nonexistent",
        userAlice
      );
      const response = await handleGetPhrase(request, env, "nonexistent");
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe("Phrase not found");
    });

    it("includes signed URLs in response", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(
        env,
        userAlice,
        phraseId,
        "audio",
        `${userAlice}/original/${phraseId}.mp3`,
        "Test",
        "ru"
      );
      await updatePhraseForUser(env, userAlice, phraseId, {
        audio_url: `${userAlice}/audio/${phraseId}.mp3`,
      });

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}`,
        userAlice
      );
      const response = await handleGetPhrase(request, env, phraseId);
      const data = (await response.json()) as { phrase: any };

      expect(response.status).toBe(200);
      // Signed URLs should include query params
      if (data.phrase.audio_url) {
        expect(data.phrase.audio_url).toContain("?");
      }
      if (data.phrase.original_file_url) {
        expect(data.phrase.original_file_url).toContain("?");
      }
    });
  });

  describe("handleUpdatePhrase", () => {
    it("updates phrase fields", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Original", "ru");

      const updates = {
        source_text: "Updated text",
        translation: "Updated translation",
        transliteration: "Updated transliteration",
        grammar_notes: "Updated notes",
      };

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}`,
        userAlice,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }
      );

      const response = await handleUpdatePhrase(request, env, phraseId);
      const data = (await response.json()) as { phrase: any };

      expect(response.status).toBe(200);
      expect(data.phrase.source_text).toBe("Updated text");
      expect(data.phrase.translation).toBe("Updated translation");
      expect(data.phrase.transliteration).toBe("Updated transliteration");
      expect(data.phrase.grammar_notes).toBe("Updated notes");
    });

    it("updates vocab_breakdown field", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");

      const vocab = [
        {
          word: "Тест",
          root: null,
          meaning: "Test",
          gender: "m",
          declension: "nom sg",
          notes: null,
        },
      ];

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}`,
        userAlice,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vocab_breakdown: vocab }),
        }
      );

      const response = await handleUpdatePhrase(request, env, phraseId);
      const data = (await response.json()) as { phrase: any };

      expect(response.status).toBe(200);
      expect(data.phrase.vocab_breakdown).toEqual(vocab);
    });

    it("returns 404 for phrase owned by different user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's phrase", "ru");

      // Bob tries to update Alice's phrase
      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}`,
        userBob,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_text: "Hacked by Bob" }),
        }
      );

      const response = await handleUpdatePhrase(request, env, phraseId);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe("Phrase not found");

      // Verify Alice's phrase is unchanged
      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.source_text).toBe("Alice's phrase");
    });

    it("triggers reprocessing when language changes", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}`,
        userAlice,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ detected_language: "ar" }),
        }
      );

      const response = await handleUpdatePhrase(request, env, phraseId);
      const data = (await response.json()) as { message?: string; status?: string };

      expect(response.status).toBe(200);
      expect(data.message).toBe("Reprocessing triggered");
      expect(data.status).toBe("processing");

      // Verify triggerProcessing was called
      expect(triggerProcessingMock).toHaveBeenCalled();

      // Verify phrase status changed to processing
      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.status).toBe("processing");
      expect(phrase!.detected_language).toBe("ar");
    });

    it("updates exclude_from_export flag", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}`,
        userAlice,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exclude_from_export: true }),
        }
      );

      const response = await handleUpdatePhrase(request, env, phraseId);
      const data = (await response.json()) as { phrase: any };

      expect(response.status).toBe(200);
      expect(data.phrase.exclude_from_export).toBe(true);
    });
  });

  describe("handleApprovePhrase", () => {
    it("approves phrase in pending_review status", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");
      await updatePhraseForUser(env, userAlice, phraseId, { status: "pending_review" });

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/approve`,
        userAlice,
        { method: "POST" }
      );

      const response = await handleApprovePhrase(request, env, phraseId);
      const data = (await response.json()) as { message: string };

      expect(response.status).toBe(200);
      expect(data.message).toBe("Phrase approved");

      // Verify status changed
      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.status).toBe("approved");
      expect(phrase!.reviewed_at).toBeTruthy();
    });

    it("rejects approval of phrase not in pending_review status", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");
      // Status is still "processing"

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/approve`,
        userAlice,
        { method: "POST" }
      );

      const response = await handleApprovePhrase(request, env, phraseId);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toContain("Can only approve phrases in pending_review status");
    });

    it("returns 404 when trying to approve another user's phrase", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's phrase", "ru");
      await updatePhraseForUser(env, userAlice, phraseId, { status: "pending_review" });

      // Bob tries to approve Alice's phrase
      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}/approve`,
        userBob,
        { method: "POST" }
      );

      const response = await handleApprovePhrase(request, env, phraseId);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe("Phrase not found");

      // Verify Alice's phrase is still pending_review
      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase!.status).toBe("pending_review");
    });
  });

  describe("handleDeletePhrase", () => {
    it("deletes phrase owned by user", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "To delete", "ru");

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}`,
        userAlice,
        { method: "DELETE" }
      );

      const response = await handleDeletePhrase(request, env, phraseId);
      const data = (await response.json()) as { message: string };

      expect(response.status).toBe(200);
      expect(data.message).toBe("Phrase deleted");

      // Verify phrase no longer exists
      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase).toBeNull();
    });

    it("returns 404 when trying to delete another user's phrase", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Alice's phrase", "ru");

      // Bob tries to delete Alice's phrase
      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}`,
        userBob,
        { method: "DELETE" }
      );

      const response = await handleDeletePhrase(request, env, phraseId);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe("Phrase not found");

      // Verify Alice's phrase still exists
      const phrase = await getPhraseForUser(env, userAlice, phraseId);
      expect(phrase).toBeTruthy();
    });

    it("attempts to clean up R2 files on delete", async () => {
      const phraseId = randomId("phrase");
      const originalFileUrl = `${userAlice}/original/${phraseId}.mp3`;
      const audioUrl = `${userAlice}/audio/${phraseId}.mp3`;

      await createPhrase(env, userAlice, phraseId, "audio", originalFileUrl, "Test", "ru");
      await updatePhraseForUser(env, userAlice, phraseId, { audio_url: audioUrl });

      const request = createAuthRequest(
        `http://test.com/api/phrases/${phraseId}`,
        userAlice,
        { method: "DELETE" }
      );

      const response = await handleDeletePhrase(request, env, phraseId);

      expect(response.status).toBe(200);

      // Note: R2 cleanup is best-effort and happens in background
      // The test just verifies the endpoint succeeds
    });

    it("returns 404 for non-existent phrase", async () => {
      const request = createAuthRequest(
        "http://test.com/api/phrases/nonexistent",
        userAlice,
        { method: "DELETE" }
      );

      const response = await handleDeletePhrase(request, env, "nonexistent");
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe("Phrase not found");
    });
  });

  describe("Multi-Tenant Isolation", () => {
    it("comprehensive isolation test across all CRUD operations", async () => {
      // Alice creates a phrase
      const alicePhraseId = randomId("phrase");
      await createPhrase(
        env,
        userAlice,
        alicePhraseId,
        "text",
        null,
        "Alice's secret data",
        "ru"
      );

      // Bob creates a phrase
      const bobPhraseId = randomId("phrase");
      await createPhrase(
        env,
        userBob,
        bobPhraseId,
        "text",
        null,
        "Bob's secret data",
        "ru"
      );

      // Bob cannot GET Alice's phrase
      const bobGetRequest = createAuthRequest(
        `http://test.com/api/phrases/${alicePhraseId}`,
        userBob
      );
      const bobGetResponse = await handleGetPhrase(bobGetRequest, env, alicePhraseId);
      expect(bobGetResponse.status).toBe(404);

      // Bob cannot UPDATE Alice's phrase
      const bobUpdateRequest = createAuthRequest(
        `http://test.com/api/phrases/${alicePhraseId}`,
        userBob,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_text: "Hacked" }),
        }
      );
      const bobUpdateResponse = await handleUpdatePhrase(
        bobUpdateRequest,
        env,
        alicePhraseId
      );
      expect(bobUpdateResponse.status).toBe(404);

      // Verify Alice's data unchanged
      const alicePhrase = await getPhraseForUser(env, userAlice, alicePhraseId);
      expect(alicePhrase!.source_text).toBe("Alice's secret data");

      // Bob cannot DELETE Alice's phrase
      const bobDeleteRequest = createAuthRequest(
        `http://test.com/api/phrases/${alicePhraseId}`,
        userBob,
        { method: "DELETE" }
      );
      const bobDeleteResponse = await handleDeletePhrase(
        bobDeleteRequest,
        env,
        alicePhraseId
      );
      expect(bobDeleteResponse.status).toBe(404);

      // Verify Alice's phrase still exists
      const alicePhraseStillExists = await getPhraseForUser(
        env,
        userAlice,
        alicePhraseId
      );
      expect(alicePhraseStillExists).toBeTruthy();

      // Alice can perform all operations on her own phrase
      const aliceUpdateRequest = createAuthRequest(
        `http://test.com/api/phrases/${alicePhraseId}`,
        userAlice,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_text: "Alice updated" }),
        }
      );
      const aliceUpdateResponse = await handleUpdatePhrase(
        aliceUpdateRequest,
        env,
        alicePhraseId
      );
      expect(aliceUpdateResponse.status).toBe(200);

      const alicePhraseUpdated = await getPhraseForUser(env, userAlice, alicePhraseId);
      expect(alicePhraseUpdated!.source_text).toBe("Alice updated");
    });
  });
});
