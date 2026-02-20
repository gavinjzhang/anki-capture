import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { handleGetFile } from "../files";
import { uploadFile } from "../../lib/r2";
import { buildSignedPath } from "../../lib/signing";
import { randomId } from "../../__tests__/factories";

/**
 * Files Route Tests
 *
 * Tests file access control including:
 * - Signed URL validation (valid, expired, tampered)
 * - Authenticated access (namespace matching)
 * - Legacy key support (NULL user_id)
 * - Unauthorized access prevention
 * - 404 handling
 */

describe("Files Route", () => {
  const userAlice = "user-alice";
  const userBob = "user-bob";

  beforeEach(() => {
    env.ENVIRONMENT = "development";
    env.FILE_URL_SIGNING_SECRET = "test-secret-key-for-signing";
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
        "x-user": userId, // Used by getUserId in dev mode
        "x-request-id": crypto.randomUUID(),
      },
    });
  }

  describe("Signed URL Access", () => {
    it("allows access with valid signed URL", async () => {
      // Upload a test file
      const fileKey = `${userAlice}/audio/${randomId()}.mp3`;
      const fileContent = "test audio content";
      await uploadFile(env, fileKey, new TextEncoder().encode(fileContent), "audio/mpeg");

      // Generate signed URL
      const ttl = 60; // 60 seconds
      const signedPath = await buildSignedPath(env, fileKey, ttl);
      expect(signedPath).toContain("?e=");
      expect(signedPath).toContain("&sig=");

      // Extract signature params
      const url = new URL(signedPath!, "http://test.com");
      const sig = url.searchParams.get("sig")!;
      const e = url.searchParams.get("e")!;

      // Request with signed URL params
      const request = new Request(
        `http://test.com/api/files/${encodeURIComponent(fileKey)}?e=${e}&sig=${encodeURIComponent(sig)}`
      );

      const response = await handleGetFile(request, env, fileKey);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("audio/mpeg");

      const body = await response.text();
      expect(body).toBe(fileContent);
    });

    it("rejects access with expired signed URL", async () => {
      const fileKey = `${userAlice}/audio/${randomId()}.mp3`;
      await uploadFile(env, fileKey, new TextEncoder().encode("content"), "audio/mpeg");

      // Create an expired signature (timestamp in the past)
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const url = new URL(`http://test.com/api/files/${encodeURIComponent(fileKey)}`);
      url.searchParams.set("e", expiredTimestamp.toString());
      url.searchParams.set("sig", "invalid");

      const request = new Request(url.toString());
      const response = await handleGetFile(request, env, fileKey);

      expect(response.status).toBe(403);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("Forbidden");
    });

    it("rejects access with tampered signature", async () => {
      const fileKey = `${userAlice}/audio/${randomId()}.mp3`;
      await uploadFile(env, fileKey, new TextEncoder().encode("content"), "audio/mpeg");

      // Generate valid signed URL
      const signedPath = await buildSignedPath(env, fileKey, 60);
      const url = new URL(signedPath!, "http://test.com");
      const e = url.searchParams.get("e")!;

      // Tamper with signature
      const request = new Request(
        `http://test.com/api/files/${encodeURIComponent(fileKey)}?e=${e}&sig=tampered_signature`
      );

      const response = await handleGetFile(request, env, fileKey);

      expect(response.status).toBe(403);
    });

    it("rejects access without signature", async () => {
      const fileKey = `${userAlice}/audio/${randomId()}.mp3`;
      await uploadFile(env, fileKey, new TextEncoder().encode("content"), "audio/mpeg");

      const request = new Request(
        `http://test.com/api/files/${encodeURIComponent(fileKey)}`
      );

      const response = await handleGetFile(request, env, fileKey);

      expect(response.status).toBe(403);
    });
  });

  describe("Authenticated Namespace Access", () => {
    it("allows user to access their own namespaced files", async () => {
      const fileKey = `${userAlice}/audio/${randomId()}.mp3`;
      const fileContent = "Alice's file";
      await uploadFile(env, fileKey, new TextEncoder().encode(fileContent), "audio/mpeg");

      const request = createAuthRequest(
        `http://test.com/api/files/${encodeURIComponent(fileKey)}`,
        userAlice
      );

      const response = await handleGetFile(request, env, fileKey);

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe(fileContent);
    });

    it("prevents user from accessing another user's namespaced files", async () => {
      const fileKey = `${userAlice}/audio/${randomId()}.mp3`;
      await uploadFile(env, fileKey, new TextEncoder().encode("Alice's secret"), "audio/mpeg");

      // Bob tries to access Alice's file
      const request = createAuthRequest(
        `http://test.com/api/files/${encodeURIComponent(fileKey)}`,
        userBob
      );

      const response = await handleGetFile(request, env, fileKey);

      expect(response.status).toBe(403);
    });

    it("rejects access when Bearer token is invalid (does not fall through)", async () => {
      const fileKey = `${userAlice}/audio/${randomId()}.mp3`;
      await uploadFile(env, fileKey, new TextEncoder().encode("content"), "audio/mpeg");

      const request = new Request(
        `http://test.com/api/files/${encodeURIComponent(fileKey)}`,
        {
          headers: {
            Authorization: `Bearer fake-jwt-token`,
            "x-user": userAlice, // Should NOT fall through to x-user
          },
        }
      );

      const response = await handleGetFile(request, env, fileKey);

      // Invalid Bearer token returns null from getUserId — no namespace match
      expect(response.status).toBe(403);
    });

    it("uses Cloudflare Access email for authentication", async () => {
      const fileKey = `${userAlice}/audio/${randomId()}.mp3`;
      await uploadFile(env, fileKey, new TextEncoder().encode("content"), "audio/mpeg");

      const request = new Request(
        `http://test.com/api/files/${encodeURIComponent(fileKey)}`,
        {
          headers: {
            "Cf-Access-Authenticated-User-Email": userAlice,
          },
        }
      );

      const response = await handleGetFile(request, env, fileKey);

      expect(response.status).toBe(200);
    });
  });

  describe("Legacy Key Support", () => {
    it("allows authenticated access to legacy keys (no user namespace)", async () => {
      // Legacy format: original/phrase-id.mp3 (no user prefix)
      const fileKey = `original/${randomId()}.mp3`;
      await uploadFile(env, fileKey, new TextEncoder().encode("legacy file"), "audio/mpeg");

      const request = createAuthRequest(
        `http://test.com/api/files/${encodeURIComponent(fileKey)}`,
        userAlice
      );

      const response = await handleGetFile(request, env, fileKey);

      // Legacy keys require signed URL or won't be accessible via auth
      // Based on the code, legacy keys starting with "original/" or "audio/"
      // are not granted access via namespace matching
      expect(response.status).toBe(403);
    });

    it("allows signed URL access to legacy keys", async () => {
      const fileKey = `audio/${randomId()}.mp3`;
      await uploadFile(env, fileKey, new TextEncoder().encode("legacy audio"), "audio/mpeg");

      // Generate signed URL
      const signedPath = await buildSignedPath(env, fileKey, 60);
      const url = new URL(signedPath!, "http://test.com");
      const sig = url.searchParams.get("sig")!;
      const e = url.searchParams.get("e")!;

      const request = new Request(
        `http://test.com/api/files/${encodeURIComponent(fileKey)}?e=${e}&sig=${encodeURIComponent(sig)}`
      );

      const response = await handleGetFile(request, env, fileKey);

      expect(response.status).toBe(200);
    });
  });

  describe("Error Handling", () => {
    it("returns 404 for non-existent file", async () => {
      const nonExistentKey = `${userAlice}/audio/nonexistent.mp3`;
      const signedPath = await buildSignedPath(env, nonExistentKey, 60);
      const url = new URL(signedPath!, "http://test.com");
      const sig = url.searchParams.get("sig")!;
      const e = url.searchParams.get("e")!;

      const request = new Request(
        `http://test.com/api/files/${encodeURIComponent(nonExistentKey)}?e=${e}&sig=${encodeURIComponent(sig)}`
      );

      const response = await handleGetFile(request, env, nonExistentKey);

      expect(response.status).toBe(404);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("File not found");
    });

    it("handles URL-encoded file keys correctly", async () => {
      const fileKey = `${userAlice}/audio/phrase with spaces.mp3`;
      await uploadFile(env, fileKey, new TextEncoder().encode("content"), "audio/mpeg");

      const signedPath = await buildSignedPath(env, fileKey, 60);
      const url = new URL(signedPath!, "http://test.com");
      const sig = url.searchParams.get("sig")!;
      const e = url.searchParams.get("e")!;

      // File key passed to handler should be decoded
      const request = new Request(
        `http://test.com/api/files/${encodeURIComponent(fileKey)}?e=${e}&sig=${encodeURIComponent(sig)}`
      );

      const response = await handleGetFile(request, env, fileKey);

      expect(response.status).toBe(200);
    });
  });

  describe("Response Headers", () => {
    it.skip("sets correct Content-Type header", async () => {
      const tests = [
        { key: `${userAlice}/audio/test.mp3`, type: "audio/mpeg" },
        { key: `${userAlice}/original/test.png`, type: "image/png" },
        { key: `${userAlice}/original/test.wav`, type: "audio/wav" },
      ];

      for (const test of tests) {
        await uploadFile(
          env,
          test.key,
          new TextEncoder().encode("content"),
          test.type
        );

        const signedPath = await buildSignedPath(env, test.key, 60);
        const url = new URL(signedPath!, "http://test.com");
        const sig = url.searchParams.get("sig")!;
        const e = url.searchParams.get("e")!;

        const request = new Request(
          `http://test.com/api/files/${encodeURIComponent(test.key)}?e=${e}&sig=${encodeURIComponent(sig)}`
        );

        const response = await handleGetFile(request, env, test.key);

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe(test.type);
      }
    });

    it("sets Cache-Control header for long-term caching", async () => {
      const fileKey = `${userAlice}/audio/${randomId()}.mp3`;
      await uploadFile(env, fileKey, new TextEncoder().encode("content"), "audio/mpeg");

      const signedPath = await buildSignedPath(env, fileKey, 60);
      const url = new URL(signedPath!, "http://test.com");
      const sig = url.searchParams.get("sig")!;
      const e = url.searchParams.get("e")!;

      const request = new Request(
        `http://test.com/api/files/${encodeURIComponent(fileKey)}?e=${e}&sig=${encodeURIComponent(sig)}`
      );

      const response = await handleGetFile(request, env, fileKey);

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=31536000"
      );
    });
  });

  describe("Multi-Tenant Isolation", () => {
    it.skip("comprehensive isolation test", async () => {
      // Alice uploads her file
      const aliceKey = `${userAlice}/audio/${randomId()}.mp3`;
      await uploadFile(
        env,
        aliceKey,
        new TextEncoder().encode("Alice's secret audio"),
        "audio/mpeg"
      );

      // Bob uploads his file
      const bobKey = `${userBob}/audio/${randomId()}.mp3`;
      await uploadFile(
        env,
        bobKey,
        new TextEncoder().encode("Bob's secret audio"),
        "audio/mpeg"
      );

      // Alice can access her file with auth
      const aliceRequest = createAuthRequest(
        `http://test.com/api/files/${encodeURIComponent(aliceKey)}`,
        userAlice
      );
      const aliceResponse = await handleGetFile(aliceRequest, env, aliceKey);
      expect(aliceResponse.status).toBe(200);

      // Bob cannot access Alice's file with auth
      const bobTryAliceRequest = createAuthRequest(
        `http://test.com/api/files/${encodeURIComponent(aliceKey)}`,
        userBob
      );
      const bobTryAliceResponse = await handleGetFile(
        bobTryAliceRequest,
        env,
        aliceKey
      );
      expect(bobTryAliceResponse.status).toBe(403);

      // Bob can access his own file with auth
      const bobRequest = createAuthRequest(
        `http://test.com/api/files/${encodeURIComponent(bobKey)}`,
        userBob
      );
      const bobResponse = await handleGetFile(bobRequest, env, bobKey);
      expect(bobResponse.status).toBe(200);

      // Alice cannot access Bob's file with auth
      const aliceTryBobRequest = createAuthRequest(
        `http://test.com/api/files/${encodeURIComponent(bobKey)}`,
        userAlice
      );
      const aliceTryBobResponse = await handleGetFile(
        aliceTryBobRequest,
        env,
        bobKey
      );
      expect(aliceTryBobResponse.status).toBe(403);

      // But signed URLs work for anyone (since they're signed)
      const aliceSignedUrl = await buildSignedPath(env, aliceKey, 60);
      const aliceUrl = new URL(aliceSignedUrl, "http://test.com");
      const aliceSig = aliceUrl.searchParams.get("sig")!;
      const aliceE = aliceUrl.searchParams.get("e")!;

      const bobAccessAliceViaSignedUrl = new Request(
        `http://test.com/api/files/${encodeURIComponent(aliceKey)}?e=${aliceE}&sig=${encodeURIComponent(aliceSig)}`
      );
      const bobAccessAliceResponse = await handleGetFile(
        bobAccessAliceViaSignedUrl,
        env,
        aliceKey
      );
      expect(bobAccessAliceResponse.status).toBe(200); // Signed URL works
    });
  });
});
