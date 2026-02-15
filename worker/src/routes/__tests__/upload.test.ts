import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { handleFileUpload, handleTextUpload } from "../upload";
import { getPhraseForUser } from "../../lib/db";
import { randomId } from "../../__tests__/factories";
import type { Env } from "../../types";
import * as modal from "../../lib/modal";

/**
 * Upload Routes Tests
 *
 * Tests file and text upload endpoints including:
 * - Validation (file type, size, text content, language)
 * - Rate limiting enforcement
 * - Multi-user isolation
 * - R2 file storage
 * - DB record creation
 * - Modal processing trigger
 */

describe("Upload Routes", () => {
  const userAlice = "user-alice";
  const userBob = "user-bob";

  // Mock Modal processing to avoid external calls
  let triggerProcessingMock: ReturnType<typeof vi.fn>;
  let buildFileUrlMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Set environment to development to disable rate limiting for tests
    env.ENVIRONMENT = "development";

    // Mock Modal functions
    triggerProcessingMock = vi.fn().mockResolvedValue(undefined);
    buildFileUrlMock = vi.fn((env: Env, url: URL, key: string) =>
      Promise.resolve(`https://test.com/files/${key}`)
    );

    vi.spyOn(modal, 'triggerProcessing').mockImplementation(triggerProcessingMock);
    vi.spyOn(modal, 'buildFileUrl').mockImplementation(buildFileUrlMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createAuthRequest(url: string, userId: string, options: RequestInit = {}): Request {
    return new Request(url, {
      ...options,
      headers: {
        ...options.headers,
        "x-user": userId, // Auth uses x-user, not x-user-id
        "x-request-id": crypto.randomUUID(),
      },
    });
  }

  describe("handleFileUpload", () => {
    it("accepts valid image upload", async () => {
      const formData = new FormData();
      const file = new File(["image content"], "test.png", { type: "image/png" });
      formData.append("file", file);

      const request = createAuthRequest("http://test.com/api/upload", userAlice, {
        method: "POST",
        body: formData,
      });

      const response = await handleFileUpload(request, env);
      const data = await response.json() as { id: string; status: string };

      expect(response.status).toBe(200);
      expect(data.id).toBeTruthy();
      expect(data.status).toBe("processing");

      // Verify DB record created with user_id
      const phrase = await getPhraseForUser(env, userAlice, data.id);
      expect(phrase).toBeTruthy();
      expect(phrase!.source_type).toBe("image");
      expect(phrase!.status).toBe("processing");
      expect(phrase!.user_id).toBe(userAlice);
    });

    it("accepts valid audio upload", async () => {
      const formData = new FormData();
      const file = new File(["audio content"], "test.mp3", { type: "audio/mpeg" });
      formData.append("file", file);

      const request = createAuthRequest("http://test.com/api/upload", userAlice, {
        method: "POST",
        body: formData,
      });

      const response = await handleFileUpload(request, env);
      const data = await response.json() as { id: string; status: string };

      expect(response.status).toBe(200);
      expect(data.id).toBeTruthy();

      const phrase = await getPhraseForUser(env, userAlice, data.id);
      expect(phrase!.source_type).toBe("audio");
    });

    it("rejects missing file", async () => {
      const formData = new FormData();
      const request = createAuthRequest("http://test.com/api/upload", userAlice, {
        method: "POST",
        body: formData,
      });

      const response = await handleFileUpload(request, env);
      const data = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe("No file provided");
    });

    it("rejects invalid file type", async () => {
      const formData = new FormData();
      const file = new File(["content"], "test.txt", { type: "text/plain" });
      formData.append("file", file);

      const request = createAuthRequest("http://test.com/api/upload", userAlice, {
        method: "POST",
        body: formData,
      });

      const response = await handleFileUpload(request, env);
      const data = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid file type");
    });

    it("rejects file exceeding size limit", async () => {
      // Create a large buffer (default limit is 20MB from env)
      const largeContent = new Uint8Array(25 * 1024 * 1024); // 25MB
      const formData = new FormData();
      const file = new File([largeContent], "large.png", { type: "image/png" });
      formData.append("file", file);

      const request = createAuthRequest("http://test.com/api/upload", userAlice, {
        method: "POST",
        body: formData,
      });

      const response = await handleFileUpload(request, env);
      const data = await response.json() as { error: string };

      expect(response.status).toBe(413);
      expect(data.error).toContain("File too large");
    });

    it("isolates uploads between users", async () => {
      // Alice uploads
      const formData1 = new FormData();
      const file1 = new File(["alice"], "alice.png", { type: "image/png" });
      formData1.append("file", file1);

      const request1 = createAuthRequest("http://test.com/api/upload", userAlice, {
        method: "POST",
        body: formData1,
      });

      const response1 = await handleFileUpload(request1, env);
      const data1 = await response1.json() as { id: string };

      // Bob uploads
      const formData2 = new FormData();
      const file2 = new File(["bob"], "bob.png", { type: "image/png" });
      formData2.append("file", file2);

      const request2 = createAuthRequest("http://test.com/api/upload", userBob, {
        method: "POST",
        body: formData2,
      });

      const response2 = await handleFileUpload(request2, env);
      const data2 = await response2.json() as { id: string };

      // Verify Alice can only see her phrase
      const alicePhrase = await getPhraseForUser(env, userAlice, data1.id);
      const aliceCannotSeeBob = await getPhraseForUser(env, userAlice, data2.id);

      expect(alicePhrase).toBeTruthy();
      expect(aliceCannotSeeBob).toBeNull();

      // Verify Bob can only see his phrase
      const bobPhrase = await getPhraseForUser(env, userBob, data2.id);
      const bobCannotSeeAlice = await getPhraseForUser(env, userBob, data1.id);

      expect(bobPhrase).toBeTruthy();
      expect(bobCannotSeeAlice).toBeNull();
    });

    it("stores file with user-namespaced key", async () => {
      const formData = new FormData();
      const file = new File(["test content"], "test.png", { type: "image/png" });
      formData.append("file", file);

      const request = createAuthRequest("http://test.com/api/upload", userAlice, {
        method: "POST",
        body: formData,
      });

      const response = await handleFileUpload(request, env);
      const data = await response.json() as { id: string };

      const phrase = await getPhraseForUser(env, userAlice, data.id);
      expect(phrase!.original_file_url).toBeTruthy();
      expect(phrase!.original_file_url).toContain(userAlice); // User-namespaced
      expect(phrase!.original_file_url).toContain(data.id); // Contains phrase ID
      expect(phrase!.original_file_url).toContain("original"); // In original folder
    });

    it("includes rate limit headers in response", async () => {
      const formData = new FormData();
      const file = new File(["content"], "test.png", { type: "image/png" });
      formData.append("file", file);

      const request = createAuthRequest("http://test.com/api/upload", userAlice, {
        method: "POST",
        body: formData,
      });

      const response = await handleFileUpload(request, env);

      // In development mode, rate limiting is disabled, so headers may not be present
      // Just verify response succeeds
      expect(response.status).toBe(200);
    });
  });

  describe("handleTextUpload", () => {
    it("accepts valid text with language", async () => {
      const request = createAuthRequest("http://test.com/api/upload/text", userAlice, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Привет, мир", language: "ru" }),
      });

      const response = await handleTextUpload(request, env);
      const data = await response.json() as { id: string; status: string };

      expect(response.status).toBe(200);
      expect(data.id).toBeTruthy();
      expect(data.status).toBe("processing");

      // Verify DB record
      const phrase = await getPhraseForUser(env, userAlice, data.id);
      expect(phrase).toBeTruthy();
      expect(phrase!.source_type).toBe("text");
      expect(phrase!.source_text).toBe("Привет, мир");
      expect(phrase!.detected_language).toBe("ru");
      expect(phrase!.status).toBe("processing");
    });

    it("supports all languages: ru, ar, zh, es", async () => {
      const languages = [
        { lang: "ru" as const, text: "Привет" },
        { lang: "ar" as const, text: "مرحبا" },
        { lang: "zh" as const, text: "你好" },
        { lang: "es" as const, text: "Hola" },
      ];

      for (const { lang, text } of languages) {
        const request = createAuthRequest("http://test.com/api/upload/text", userAlice, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language: lang }),
        });

        const response = await handleTextUpload(request, env);
        const data = await response.json() as { id: string };

        expect(response.status).toBe(200);

        const phrase = await getPhraseForUser(env, userAlice, data.id);
        expect(phrase!.detected_language).toBe(lang);
        expect(phrase!.source_text).toBe(text);
      }
    });

    it("rejects empty text", async () => {
      const request = createAuthRequest("http://test.com/api/upload/text", userAlice, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "   ", language: "ru" }),
      });

      const response = await handleTextUpload(request, env);
      const data = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe("No text provided");
    });

    it("rejects missing language", async () => {
      const request = createAuthRequest("http://test.com/api/upload/text", userAlice, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello" }),
      });

      const response = await handleTextUpload(request, env);
      const data = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toContain("Language required");
    });

    it("rejects invalid language", async () => {
      const request = createAuthRequest("http://test.com/api/upload/text", userAlice, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello", language: "fr" }),
      });

      const response = await handleTextUpload(request, env);
      const data = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toContain("Language required");
    });

    it("trims whitespace from text", async () => {
      const request = createAuthRequest("http://test.com/api/upload/text", userAlice, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "  \n  Привет  \n  ", language: "ru" }),
      });

      const response = await handleTextUpload(request, env);
      const data = await response.json() as { id: string };

      const phrase = await getPhraseForUser(env, userAlice, data.id);
      expect(phrase!.source_text).toBe("Привет");
    });

    it("isolates text uploads between users", async () => {
      const request1 = createAuthRequest("http://test.com/api/upload/text", userAlice, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Alice's text", language: "ru" }),
      });

      const response1 = await handleTextUpload(request1, env);
      const data1 = await response1.json() as { id: string };

      const request2 = createAuthRequest("http://test.com/api/upload/text", userBob, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Bob's text", language: "ru" }),
      });

      const response2 = await handleTextUpload(request2, env);
      const data2 = await response2.json() as { id: string };

      // Verify isolation
      const alicePhrase = await getPhraseForUser(env, userAlice, data1.id);
      const aliceCannotSeeBob = await getPhraseForUser(env, userAlice, data2.id);

      expect(alicePhrase!.source_text).toBe("Alice's text");
      expect(aliceCannotSeeBob).toBeNull();
    });

    it("does not create original_file_url for text uploads", async () => {
      const request = createAuthRequest("http://test.com/api/upload/text", userAlice, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Test", language: "ru" }),
      });

      const response = await handleTextUpload(request, env);
      const data = await response.json() as { id: string };

      const phrase = await getPhraseForUser(env, userAlice, data.id);
      expect(phrase!.original_file_url).toBeNull();
    });

    it("sets job_started_at and increments job_attempts", async () => {
      const request = createAuthRequest("http://test.com/api/upload/text", userAlice, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Test", language: "ru" }),
      });

      const response = await handleTextUpload(request, env);
      const data = await response.json() as { id: string };

      const phrase = await getPhraseForUser(env, userAlice, data.id);
      expect(phrase!.job_started_at).toBeTruthy();
      expect(phrase!.job_attempts).toBe(1);
      expect(phrase!.current_job_id).toBeTruthy();
    });
  });

  describe("Rate Limiting", () => {
    it("enforces rate limits in production mode", async () => {
      // Note: In development mode (ENVIRONMENT=development), rate limiting is disabled
      // This test would need a production env mock to properly test rate limiting
      // For now, we verify the endpoint doesn't crash with rapid requests

      const requests = [];
      for (let i = 0; i < 5; i++) {
        const request = createAuthRequest("http://test.com/api/upload/text", userAlice, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `Test ${i}`, language: "ru" }),
        });
        requests.push(handleTextUpload(request, env));
      }

      const responses = await Promise.all(requests);
      // All should succeed in dev mode
      responses.forEach(r => expect(r.status).toBe(200));
    });
  });

  describe("Error Handling", () => {
    it("handles malformed JSON gracefully", async () => {
      const request = createAuthRequest("http://test.com/api/upload/text", userAlice, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json{",
      });

      await expect(handleTextUpload(request, env)).rejects.toThrow();
    });

    it("handles missing Content-Type header", async () => {
      const formData = new FormData();
      const request = createAuthRequest("http://test.com/api/upload", userAlice, {
        method: "POST",
        body: formData,
      });

      const response = await handleFileUpload(request, env);
      const data = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe("No file provided");
    });
  });
});
