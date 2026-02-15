import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  handleExport,
  handleExportPreview,
  handleExportComplete,
} from "../export";
import { createPhrase, updatePhraseForUser, getPhraseForUser } from "../../lib/db";
import { randomId } from "../../__tests__/factories";

/**
 * Export Routes Tests
 *
 * Tests export endpoints including:
 * - Export data (Anki format, audio URLs, empty state)
 * - Export preview (count, preview list)
 * - Mark as exported (user isolation, status updates)
 * - Signed URL generation
 * - Multi-user isolation
 */

describe("Export Routes", () => {
  const userAlice = "user-alice";
  const userBob = "user-bob";

  beforeEach(() => {
    env.ENVIRONMENT = "development";
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

  describe("handleExportPreview", () => {
    it("returns count and preview of exportable phrases", async () => {
      // Create approved phrases for Alice
      for (let i = 0; i < 7; i++) {
        const phraseId = randomId("phrase");
        await createPhrase(env, userAlice, phraseId, "text", null, `Alice ${i}`, "ru");
        await updatePhraseForUser(env, userAlice, phraseId, { status: "approved" });
      }

      const request = createAuthRequest("http://test.com/api/export/preview", userAlice);
      const response = await handleExportPreview(request, env);
      const data = (await response.json()) as {
        count: number;
        preview: Array<{ id: string; source_text: string }>;
      };

      expect(response.status).toBe(200);
      expect(data.count).toBe(7);
      expect(data.preview.length).toBeLessThanOrEqual(5); // Preview limited to 5
      expect(data.preview.every((p) => p.source_text?.startsWith("Alice"))).toBe(true);
    });

    it("returns zero count when no approved phrases", async () => {
      const request = createAuthRequest("http://test.com/api/export/preview", userAlice);
      const response = await handleExportPreview(request, env);
      const data = (await response.json()) as { count: number; preview: any[] };

      expect(response.status).toBe(200);
      expect(data.count).toBe(0);
      expect(data.preview.length).toBe(0);
    });

    it("excludes phrases with exclude_from_export=true", async () => {
      const phraseId1 = randomId("phrase");
      const phraseId2 = randomId("phrase");

      await createPhrase(env, userAlice, phraseId1, "text", null, "Include", "ru");
      await createPhrase(env, userAlice, phraseId2, "text", null, "Exclude", "ru");

      await updatePhraseForUser(env, userAlice, phraseId1, { status: "approved" });
      await updatePhraseForUser(env, userAlice, phraseId2, {
        status: "approved",
        exclude_from_export: true,
      });

      const request = createAuthRequest("http://test.com/api/export/preview", userAlice);
      const response = await handleExportPreview(request, env);
      const data = (await response.json()) as { count: number; preview: any[] };

      expect(data.count).toBe(1);
      expect(data.preview[0].source_text).toBe("Include");
    });

    it("isolates preview between users", async () => {
      // Alice: 3 approved
      for (let i = 0; i < 3; i++) {
        const phraseId = randomId("phrase");
        await createPhrase(env, userAlice, phraseId, "text", null, `Alice ${i}`, "ru");
        await updatePhraseForUser(env, userAlice, phraseId, { status: "approved" });
      }

      // Bob: 2 approved
      for (let i = 0; i < 2; i++) {
        const phraseId = randomId("phrase");
        await createPhrase(env, userBob, phraseId, "text", null, `Bob ${i}`, "ru");
        await updatePhraseForUser(env, userBob, phraseId, { status: "approved" });
      }

      const requestAlice = createAuthRequest(
        "http://test.com/api/export/preview",
        userAlice
      );
      const responseAlice = await handleExportPreview(requestAlice, env);
      const dataAlice = (await responseAlice.json()) as { count: number };

      const requestBob = createAuthRequest("http://test.com/api/export/preview", userBob);
      const responseBob = await handleExportPreview(requestBob, env);
      const dataBob = (await responseBob.json()) as { count: number };

      expect(dataAlice.count).toBe(3);
      expect(dataBob.count).toBe(2);
    });
  });

  describe("handleExport", () => {
    it("exports phrases in Anki format", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Привет", "ru");
      await updatePhraseForUser(env, userAlice, phraseId, {
        status: "approved",
        translation: "Hello",
        transliteration: "Privet",
        grammar_notes: "Informal greeting",
        audio_url: `${userAlice}/audio/${phraseId}.mp3`,
      });

      const request = createAuthRequest("http://test.com/api/export", userAlice);
      const response = await handleExport(request, env);
      const data = (await response.json()) as {
        phrases: Array<{ id: string; line: string; audio_url: string | null }>;
        txt_content: string;
      };

      expect(response.status).toBe(200);
      expect(data.phrases.length).toBe(1);

      const phrase = data.phrases[0];
      expect(phrase.id).toBe(phraseId);
      expect(phrase.line).toContain("Привет");
      expect(phrase.line).toContain("Hello");
      expect(phrase.line).toContain("Informal greeting");
      expect(phrase.line).toContain(`[sound:${phraseId}.mp3]`);
      expect(phrase.line).toContain("Privet");

      // Verify tab-separated format
      const fields = phrase.line.split("\t");
      expect(fields.length).toBe(6); // source, translation, notes, vocab, audio, translit

      // Verify txt_content has newline-separated lines
      expect(data.txt_content).toContain("Привет");
    });

    it("formats vocab_breakdown correctly", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");
      await updatePhraseForUser(env, userAlice, phraseId, {
        status: "approved",
        vocab_breakdown: [
          {
            word: "тест",
            root: "тест",
            meaning: "test",
            gender: "m",
            declension: "nom sg",
            notes: "Test word",
          },
        ],
      });

      const request = createAuthRequest("http://test.com/api/export", userAlice);
      const response = await handleExport(request, env);
      const data = (await response.json()) as { phrases: any[] };

      const phrase = data.phrases[0];
      expect(phrase.line).toContain("тест");
      expect(phrase.line).toContain("test");
      expect(phrase.line).toContain("[m]");
      expect(phrase.line).toContain("(nom sg)");
    });

    it("includes signed URLs for audio", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(env, userAlice, phraseId, "text", null, "Test", "ru");
      await updatePhraseForUser(env, userAlice, phraseId, {
        status: "approved",
        audio_url: `${userAlice}/audio/${phraseId}.mp3`,
      });

      const request = createAuthRequest("http://test.com/api/export", userAlice);
      const response = await handleExport(request, env);
      const data = (await response.json()) as { phrases: any[] };

      const phrase = data.phrases[0];
      expect(phrase.audio_url).toBeTruthy();
      // Signed URLs should include query params (e, sig)
      expect(phrase.audio_url).toContain("?");
    });

    it("returns 404 when no exportable phrases", async () => {
      const request = createAuthRequest("http://test.com/api/export", userAlice);
      const response = await handleExport(request, env);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe("No phrases available for export");
    });

    it("only exports approved phrases", async () => {
      // Create phrases in different statuses
      const processingId = randomId("phrase");
      const pendingId = randomId("phrase");
      const approvedId = randomId("phrase");

      await createPhrase(env, userAlice, processingId, "text", null, "Processing", "ru");
      await createPhrase(env, userAlice, pendingId, "text", null, "Pending", "ru");
      await createPhrase(env, userAlice, approvedId, "text", null, "Approved", "ru");

      await updatePhraseForUser(env, userAlice, pendingId, {
        status: "pending_review",
      });
      await updatePhraseForUser(env, userAlice, approvedId, { status: "approved" });

      const request = createAuthRequest("http://test.com/api/export", userAlice);
      const response = await handleExport(request, env);
      const data = (await response.json()) as { phrases: any[] };

      expect(data.phrases.length).toBe(1);
      expect(data.phrases[0].id).toBe(approvedId);
    });

    it("isolates exports between users", async () => {
      // Alice: 2 approved
      const aliceId1 = randomId("phrase");
      const aliceId2 = randomId("phrase");
      await createPhrase(env, userAlice, aliceId1, "text", null, "Alice 1", "ru");
      await createPhrase(env, userAlice, aliceId2, "text", null, "Alice 2", "ru");
      await updatePhraseForUser(env, userAlice, aliceId1, { status: "approved" });
      await updatePhraseForUser(env, userAlice, aliceId2, { status: "approved" });

      // Bob: 1 approved
      const bobId = randomId("phrase");
      await createPhrase(env, userBob, bobId, "text", null, "Bob 1", "ru");
      await updatePhraseForUser(env, userBob, bobId, { status: "approved" });

      const requestAlice = createAuthRequest("http://test.com/api/export", userAlice);
      const responseAlice = await handleExport(requestAlice, env);
      const dataAlice = (await responseAlice.json()) as { phrases: any[] };

      const requestBob = createAuthRequest("http://test.com/api/export", userBob);
      const responseBob = await handleExport(requestBob, env);
      const dataBob = (await responseBob.json()) as { phrases: any[] };

      expect(dataAlice.phrases.length).toBe(2);
      expect(dataBob.phrases.length).toBe(1);

      // Verify no cross-contamination
      const aliceIds = dataAlice.phrases.map((p) => p.id);
      const bobIds = dataBob.phrases.map((p) => p.id);
      expect(aliceIds).not.toContain(bobId);
      expect(bobIds).not.toContain(aliceId1);
    });

    it("escapes tabs and newlines in fields", async () => {
      const phraseId = randomId("phrase");
      await createPhrase(
        env,
        userAlice,
        phraseId,
        "text",
        null,
        "Text\twith\ttabs",
        "ru"
      );
      await updatePhraseForUser(env, userAlice, phraseId, {
        status: "approved",
        translation: "Line1\nLine2",
        grammar_notes: "Note\twith\ttab",
      });

      const request = createAuthRequest("http://test.com/api/export", userAlice);
      const response = await handleExport(request, env);
      const data = (await response.json()) as { phrases: any[] };

      const line = data.phrases[0].line;

      // Tabs should be replaced with spaces
      expect(line).not.toMatch(/Text\twith\ttabs/);
      expect(line).toContain("Text with tabs");

      // Newlines should be replaced with spaces
      expect(line).not.toMatch(/Line1\nLine2/);
      expect(line).toContain("Line1 Line2");
    });
  });

  describe("handleExportComplete", () => {
    it("marks phrases as exported", async () => {
      const phraseId1 = randomId("phrase");
      const phraseId2 = randomId("phrase");

      await createPhrase(env, userAlice, phraseId1, "text", null, "Test 1", "ru");
      await createPhrase(env, userAlice, phraseId2, "text", null, "Test 2", "ru");
      await updatePhraseForUser(env, userAlice, phraseId1, { status: "approved" });
      await updatePhraseForUser(env, userAlice, phraseId2, { status: "approved" });

      const request = createAuthRequest(
        "http://test.com/api/export/complete",
        userAlice,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phrase_ids: [phraseId1, phraseId2] }),
        }
      );

      const response = await handleExportComplete(request, env);
      const data = (await response.json()) as { message: string };

      expect(response.status).toBe(200);
      expect(data.message).toContain("2 phrases");

      // Verify phrases marked as exported
      const phrase1 = await getPhraseForUser(env, userAlice, phraseId1);
      const phrase2 = await getPhraseForUser(env, userAlice, phraseId2);

      expect(phrase1!.status).toBe("exported");
      expect(phrase1!.exported_at).toBeTruthy();
      expect(phrase2!.status).toBe("exported");
      expect(phrase2!.exported_at).toBeTruthy();
    });

    it("returns 400 when no phrase IDs provided", async () => {
      const request = createAuthRequest(
        "http://test.com/api/export/complete",
        userAlice,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phrase_ids: [] }),
        }
      );

      const response = await handleExportComplete(request, env);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe("No phrase IDs provided");
    });

    it("does not mark other user's phrases as exported", async () => {
      const alicePhraseId = randomId("phrase");
      const bobPhraseId = randomId("phrase");

      await createPhrase(env, userAlice, alicePhraseId, "text", null, "Alice", "ru");
      await createPhrase(env, userBob, bobPhraseId, "text", null, "Bob", "ru");
      await updatePhraseForUser(env, userAlice, alicePhraseId, {
        status: "approved",
      });
      await updatePhraseForUser(env, userBob, bobPhraseId, { status: "approved" });

      // Alice tries to mark Bob's phrase as exported
      const request = createAuthRequest(
        "http://test.com/api/export/complete",
        userAlice,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phrase_ids: [bobPhraseId] }),
        }
      );

      await handleExportComplete(request, env);

      // Bob's phrase should still be approved (not exported)
      const bobPhrase = await getPhraseForUser(env, userBob, bobPhraseId);
      expect(bobPhrase!.status).toBe("approved");
      expect(bobPhrase!.exported_at).toBeNull();
    });

    it("only marks user's own phrases", async () => {
      const alicePhraseId = randomId("phrase");
      const bobPhraseId = randomId("phrase");

      await createPhrase(env, userAlice, alicePhraseId, "text", null, "Alice", "ru");
      await createPhrase(env, userBob, bobPhraseId, "text", null, "Bob", "ru");
      await updatePhraseForUser(env, userAlice, alicePhraseId, {
        status: "approved",
      });
      await updatePhraseForUser(env, userBob, bobPhraseId, { status: "approved" });

      // Alice tries to mark both her phrase and Bob's phrase
      const request = createAuthRequest(
        "http://test.com/api/export/complete",
        userAlice,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phrase_ids: [alicePhraseId, bobPhraseId] }),
        }
      );

      await handleExportComplete(request, env);

      // Alice's phrase should be exported
      const alicePhrase = await getPhraseForUser(env, userAlice, alicePhraseId);
      expect(alicePhrase!.status).toBe("exported");

      // Bob's phrase should still be approved
      const bobPhrase = await getPhraseForUser(env, userBob, bobPhraseId);
      expect(bobPhrase!.status).toBe("approved");
    });
  });
});
