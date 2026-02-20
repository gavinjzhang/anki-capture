import { describe, it, expect, vi, beforeEach } from "vitest";
import { getUserId, requireAuth } from "../auth";
import type { Env } from "../../types";

/**
 * Auth Layer Tests
 *
 * Tests the getUserId function which derives user identity from:
 * 1. Clerk Bearer token (JWT sub claim)
 * 2. Cloudflare Access email header
 * 3. x-user override (dev/testing)
 * 4. dev@local in development
 * 5. null (unauthenticated)
 *
 * Also tests requireAuth which throws 401 when getUserId returns null.
 *
 * CRITICAL: When a Bearer token is present but invalid, getUserId returns
 * null immediately — it does NOT fall through to weaker identity sources.
 */

describe("Auth Layer", () => {
  const mockEnvProd: Pick<Env, "CLERK_JWT_ISSUER" | "CLERK_JWKS_URL" | "ENVIRONMENT"> = {
    CLERK_JWT_ISSUER: "https://clerk.test.com",
    CLERK_JWKS_URL: "https://clerk.test.com/.well-known/jwks.json",
    ENVIRONMENT: "production",
  };

  const mockEnvDev: Pick<Env, "CLERK_JWT_ISSUER" | "CLERK_JWKS_URL" | "ENVIRONMENT"> = {
    CLERK_JWT_ISSUER: "https://clerk.test.com",
    CLERK_JWKS_URL: "https://clerk.test.com/.well-known/jwks.json",
    ENVIRONMENT: "development",
  };

  const mockEnvNoClerk: Pick<Env, "CLERK_JWT_ISSUER" | "CLERK_JWKS_URL" | "ENVIRONMENT"> = {
    CLERK_JWT_ISSUER: undefined,
    CLERK_JWKS_URL: undefined,
    ENVIRONMENT: "production",
  };

  describe("Fallback Priority Order", () => {
    it("returns null when no auth headers provided (production)", async () => {
      const request = new Request("http://example.com");
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBeNull();
    });

    it("returns dev@local when no auth headers provided (development)", async () => {
      const request = new Request("http://example.com");
      const userId = await getUserId(request, mockEnvDev as Env);
      expect(userId).toBe("dev@local");
    });

    it("extracts user from Cloudflare Access email header when no JWT", async () => {
      const request = new Request("http://example.com", {
        headers: {
          "Cf-Access-Authenticated-User-Email": "user@example.com",
        },
      });
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBe("user@example.com");
    });

    it("extracts user from x-user header when no JWT or CF Access", async () => {
      const request = new Request("http://example.com", {
        headers: {
          "x-user": "test-user-123",
        },
      });
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBe("test-user-123");
    });

    it("prefers Cloudflare Access over x-user header", async () => {
      const request = new Request("http://example.com", {
        headers: {
          "Cf-Access-Authenticated-User-Email": "cf-user@example.com",
          "x-user": "override-user",
        },
      });
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBe("cf-user@example.com");
    });

    it("x-user header falls back to dev@local in development", async () => {
      const request = new Request("http://example.com");
      const userId = await getUserId(request, mockEnvDev as Env);
      expect(userId).toBe("dev@local");
    });
  });

  describe("User ID Normalization", () => {
    it("normalizes Cloudflare Access email to lowercase", async () => {
      const request = new Request("http://example.com", {
        headers: {
          "Cf-Access-Authenticated-User-Email": "User@EXAMPLE.COM",
        },
      });
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBe("user@example.com");
    });

    it("normalizes x-user header to lowercase", async () => {
      const request = new Request("http://example.com", {
        headers: {
          "x-user": "TEST-USER-123",
        },
      });
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBe("test-user-123");
    });

    it("trims whitespace from x-user header", async () => {
      const request = new Request("http://example.com", {
        headers: {
          "x-user": "  test-user  ",
        },
      });
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBe("test-user");
    });
  });

  describe("JWT Verification — Invalid Bearer Does NOT Fall Through", () => {
    it("returns null when JWT verification fails (invalid token), even with x-user present", async () => {
      const request = new Request("http://example.com", {
        headers: {
          Authorization: "Bearer INVALID_TOKEN",
          "x-user": "fallback-user",
        },
      });
      const userId = await getUserId(request, mockEnvProd as Env);
      // CRITICAL: Must NOT fall through to x-user
      expect(userId).toBeNull();
    });

    it("falls through when Bearer header has empty token (Fetch API trims trailing space)", async () => {
      // "Bearer " gets normalized to "Bearer" by Fetch API header parsing,
      // which does NOT match startsWith("Bearer "), so falls through.
      const request = new Request("http://example.com", {
        headers: {
          Authorization: "Bearer ",
          "x-user": "fallback-user",
        },
      });
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBe("fallback-user");
    });

    it("returns null when Clerk issuer not configured and Bearer present", async () => {
      const request = new Request("http://example.com", {
        headers: {
          Authorization: "Bearer VALID_TOKEN",
          "x-user": "fallback-user",
        },
      });
      const userId = await getUserId(request, mockEnvNoClerk as Env);
      expect(userId).toBeNull();
    });

    it("returns null when JWT fails, even with CF Access email present", async () => {
      const request = new Request("http://example.com", {
        headers: {
          Authorization: "Bearer INVALID_TOKEN",
          "Cf-Access-Authenticated-User-Email": "cf-user@example.com",
        },
      });
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBeNull();
    });
  });

  describe("Authorization Header Parsing", () => {
    it("falls through when Authorization header has non-Bearer prefix", async () => {
      const request = new Request("http://example.com", {
        headers: {
          Authorization: "SomeOtherScheme token",
          "x-user": "fallback-user",
        },
      });
      const userId = await getUserId(request, mockEnvProd as Env);
      // Not a Bearer token, so falls through to x-user
      expect(userId).toBe("fallback-user");
    });

    it("handles missing Authorization header", async () => {
      const request = new Request("http://example.com", {
        headers: {
          "x-user": "fallback-user",
        },
      });
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBe("fallback-user");
    });
  });

  describe("Edge Cases", () => {
    it("handles request with no headers at all", async () => {
      const request = new Request("http://example.com");
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBeNull();
    });

    it("handles empty string values in headers", async () => {
      const request = new Request("http://example.com", {
        headers: {
          "Cf-Access-Authenticated-User-Email": "",
          "x-user": "",
        },
      });
      const userId = await getUserId(request, mockEnvDev as Env);
      // Empty strings are falsy, should fall back to dev@local
      expect(userId).toBe("dev@local");
    });

    it("returns consistent user ID across multiple calls", async () => {
      const request = new Request("http://example.com", {
        headers: {
          "x-user": "consistent-user",
        },
      });

      const userId1 = await getUserId(request, mockEnvProd as Env);
      const userId2 = await getUserId(request, mockEnvProd as Env);

      expect(userId1).toBe(userId2);
      expect(userId1).toBe("consistent-user");
    });
  });

  describe("Environment-Specific Behavior", () => {
    it("development environment defaults to dev@local", async () => {
      const request = new Request("http://example.com");
      const userId = await getUserId(request, mockEnvDev as Env);
      expect(userId).toBe("dev@local");
    });

    it("production environment defaults to null", async () => {
      const request = new Request("http://example.com");
      const userId = await getUserId(request, mockEnvProd as Env);
      expect(userId).toBeNull();
    });

    it("staging environment (not dev) defaults to null", async () => {
      const mockEnvStaging = {
        ...mockEnvProd,
        ENVIRONMENT: "staging",
      };
      const request = new Request("http://example.com");
      const userId = await getUserId(request, mockEnvStaging as Env);
      expect(userId).toBeNull();
    });
  });

  describe("Multi-User Scenarios", () => {
    it("different users get different IDs from x-user header", async () => {
      const request1 = new Request("http://example.com", {
        headers: { "x-user": "user-alice" },
      });
      const request2 = new Request("http://example.com", {
        headers: { "x-user": "user-bob" },
      });

      const userId1 = await getUserId(request1, mockEnvProd as Env);
      const userId2 = await getUserId(request2, mockEnvProd as Env);

      expect(userId1).toBe("user-alice");
      expect(userId2).toBe("user-bob");
      expect(userId1).not.toBe(userId2);
    });

    it("different CF Access emails get different IDs", async () => {
      const request1 = new Request("http://example.com", {
        headers: { "Cf-Access-Authenticated-User-Email": "alice@example.com" },
      });
      const request2 = new Request("http://example.com", {
        headers: { "Cf-Access-Authenticated-User-Email": "bob@example.com" },
      });

      const userId1 = await getUserId(request1, mockEnvProd as Env);
      const userId2 = await getUserId(request2, mockEnvProd as Env);

      expect(userId1).toBe("alice@example.com");
      expect(userId2).toBe("bob@example.com");
      expect(userId1).not.toBe(userId2);
    });
  });

  describe("requireAuth", () => {
    it("returns user ID when authenticated", async () => {
      const request = new Request("http://example.com", {
        headers: { "x-user": "test-user" },
      });
      const userId = await requireAuth(request, mockEnvProd as Env);
      expect(userId).toBe("test-user");
    });

    it("throws 401 Response when unauthenticated (production)", async () => {
      const request = new Request("http://example.com");
      try {
        await requireAuth(request, mockEnvProd as Env);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Response);
        const response = err as Response;
        expect(response.status).toBe(401);
        const body = await response.json() as { error: string; code: string };
        expect(body.error).toBe("Authentication required");
        expect(body.code).toBe("AUTH_REQUIRED");
      }
    });

    it("throws 401 when Bearer token is invalid", async () => {
      const request = new Request("http://example.com", {
        headers: {
          Authorization: "Bearer INVALID_TOKEN",
          "x-user": "fallback-user",
        },
      });
      try {
        await requireAuth(request, mockEnvProd as Env);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Response);
        expect((err as Response).status).toBe(401);
      }
    });

    it("succeeds in development with no auth headers (dev@local)", async () => {
      const request = new Request("http://example.com");
      const userId = await requireAuth(request, mockEnvDev as Env);
      expect(userId).toBe("dev@local");
    });
  });
});
