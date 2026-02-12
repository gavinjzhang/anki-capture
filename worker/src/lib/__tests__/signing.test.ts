import { describe, it, expect } from "vitest";
import {
  signFilePath,
  verifySignature,
  buildSignedPath,
  buildAbsoluteSignedUrl,
} from "../signing";
import type { Env } from "../../types";
import { nowInSeconds } from "../../__tests__/setup";

describe("File URL Signing", () => {
  const mockEnv: Pick<Env, "FILE_URL_SIGNING_SECRET"> = {
    FILE_URL_SIGNING_SECRET: "test-signing-secret-key-12345",
  };

  const mockEnvNoSecret: Pick<Env, "FILE_URL_SIGNING_SECRET"> = {
    FILE_URL_SIGNING_SECRET: undefined,
  };

  describe("signFilePath", () => {
    it("generates a signature for valid inputs", async () => {
      const key = "user123/audio/phrase-abc.mp3";
      const expires = nowInSeconds() + 3600; // 1 hour from now

      const signature = await signFilePath(mockEnv as Env, key, expires);

      expect(signature).toBeTruthy();
      expect(typeof signature).toBe("string");
      expect(signature!.length).toBeGreaterThan(20); // Base64-url encoded HMAC
    });

    it("generates different signatures for different keys", async () => {
      const expires = nowInSeconds() + 3600;

      const sig1 = await signFilePath(
        mockEnv as Env,
        "user1/audio/file1.mp3",
        expires
      );
      const sig2 = await signFilePath(
        mockEnv as Env,
        "user2/audio/file2.mp3",
        expires
      );

      expect(sig1).not.toBe(sig2);
    });

    it("generates different signatures for different expiry times", async () => {
      const key = "user123/audio/phrase.mp3";

      const sig1 = await signFilePath(mockEnv as Env, key, nowInSeconds() + 3600);
      const sig2 = await signFilePath(mockEnv as Env, key, nowInSeconds() + 7200);

      expect(sig1).not.toBe(sig2);
    });

    it("returns null when signing secret is not set", async () => {
      const key = "user123/audio/phrase.mp3";
      const expires = nowInSeconds() + 3600;

      const signature = await signFilePath(mockEnvNoSecret as Env, key, expires);

      expect(signature).toBeNull();
    });
  });

  describe("verifySignature", () => {
    it("verifies a valid signature", async () => {
      const key = "user123/audio/phrase.mp3";
      const expires = nowInSeconds() + 3600;

      const signature = await signFilePath(mockEnv as Env, key, expires);
      const isValid = await verifySignature(
        mockEnv as Env,
        key,
        expires,
        signature!
      );

      expect(isValid).toBe(true);
    });

    it("rejects a tampered key", async () => {
      const key = "user123/audio/phrase.mp3";
      const expires = nowInSeconds() + 3600;

      const signature = await signFilePath(mockEnv as Env, key, expires);
      const isValid = await verifySignature(
        mockEnv as Env,
        "TAMPERED-KEY",
        expires,
        signature!
      );

      expect(isValid).toBe(false);
    });

    it("rejects a tampered expiry", async () => {
      const key = "user123/audio/phrase.mp3";
      const expires = nowInSeconds() + 3600;

      const signature = await signFilePath(mockEnv as Env, key, expires);
      const isValid = await verifySignature(
        mockEnv as Env,
        key,
        expires + 1000, // Different expiry
        signature!
      );

      expect(isValid).toBe(false);
    });

    it("rejects a completely invalid signature", async () => {
      const key = "user123/audio/phrase.mp3";
      const expires = nowInSeconds() + 3600;

      const isValid = await verifySignature(
        mockEnv as Env,
        key,
        expires,
        "invalid-signature-abc123"
      );

      expect(isValid).toBe(false);
    });

    it("returns false when secret is not configured", async () => {
      const key = "user123/audio/phrase.mp3";
      const expires = nowInSeconds() + 3600;

      const isValid = await verifySignature(
        mockEnvNoSecret as Env,
        key,
        expires,
        "any-signature"
      );

      expect(isValid).toBe(false);
    });
  });

  describe("buildSignedPath", () => {
    it("builds a valid signed path with query parameters", async () => {
      const key = "user123/audio/phrase.mp3";
      const ttlSeconds = 300; // 5 minutes

      const path = await buildSignedPath(mockEnv as Env, key, ttlSeconds);

      expect(path).toBeTruthy();
      expect(path).toContain("/api/files/");
      expect(path).toContain("?e=");
      expect(path).toContain("&sig=");
      expect(path).toContain(encodeURIComponent(key));
    });

    it("encodes special characters in key", async () => {
      const key = "user 123/audio/phrase name.mp3";
      const ttlSeconds = 300;

      const path = await buildSignedPath(mockEnv as Env, key, ttlSeconds);

      expect(path).toContain(encodeURIComponent(key));
      expect(path).not.toContain(" "); // Spaces should be encoded
    });

    it("returns null when secret is not configured", async () => {
      const key = "user123/audio/phrase.mp3";
      const ttlSeconds = 300;

      const path = await buildSignedPath(mockEnvNoSecret as Env, key, ttlSeconds);

      expect(path).toBeNull();
    });

    it("creates paths with expiry in the future", async () => {
      const key = "user123/audio/phrase.mp3";
      const ttlSeconds = 300;

      const path = await buildSignedPath(mockEnv as Env, key, ttlSeconds);

      // Extract expiry from query string
      const expiryMatch = path!.match(/e=(\d+)/);
      expect(expiryMatch).toBeTruthy();

      const expiry = parseInt(expiryMatch![1], 10);
      const now = nowInSeconds();

      expect(expiry).toBeGreaterThan(now);
      expect(expiry).toBeLessThanOrEqual(now + ttlSeconds + 1); // Allow 1s clock skew
    });
  });

  describe("buildAbsoluteSignedUrl", () => {
    it("builds a full URL with origin", async () => {
      const origin = "https://anki-capture.example.com";
      const key = "user123/audio/phrase.mp3";
      const ttlSeconds = 300;

      const url = await buildAbsoluteSignedUrl(
        mockEnv as Env,
        origin,
        key,
        ttlSeconds
      );

      expect(url).toBeTruthy();
      expect(url!.startsWith(origin)).toBe(true);
      expect(url).toContain("/api/files/");
      expect(url).toContain("?e=");
      expect(url).toContain("&sig=");
    });

    it("handles origin with trailing slash", async () => {
      const origin = "https://anki-capture.example.com/";
      const key = "user123/audio/phrase.mp3";
      const ttlSeconds = 300;

      const url = await buildAbsoluteSignedUrl(
        mockEnv as Env,
        origin,
        key,
        ttlSeconds
      );

      expect(url).toBeTruthy();
      expect(url).not.toContain("//api/"); // Should not have double slash
    });

    it("returns null when secret is not configured", async () => {
      const origin = "https://anki-capture.example.com";
      const key = "user123/audio/phrase.mp3";
      const ttlSeconds = 300;

      const url = await buildAbsoluteSignedUrl(
        mockEnvNoSecret as Env,
        origin,
        key,
        ttlSeconds
      );

      expect(url).toBeNull();
    });
  });

  describe("Security Properties", () => {
    it("signatures are not predictable", async () => {
      const key = "user123/audio/phrase.mp3";
      const expires = nowInSeconds() + 3600;

      // Generate two signatures for the same inputs
      // They should be identical (deterministic)
      const sig1 = await signFilePath(mockEnv as Env, key, expires);
      const sig2 = await signFilePath(mockEnv as Env, key, expires);

      expect(sig1).toBe(sig2); // Same inputs = same signature (deterministic HMAC)

      // But changing ANY parameter should produce different signature
      const sig3 = await signFilePath(mockEnv as Env, key + "x", expires);
      expect(sig3).not.toBe(sig1);
    });

    it("cannot forge signature without secret", async () => {
      const key = "user123/audio/phrase.mp3";
      const expires = nowInSeconds() + 3600;

      // Try to create a signature without knowing the secret
      const fakeSignature = "hacker-generated-signature";

      const isValid = await verifySignature(
        mockEnv as Env,
        key,
        expires,
        fakeSignature
      );

      expect(isValid).toBe(false);
    });
  });
});
