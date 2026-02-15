import { Env } from '../types';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

// Cache JWKS per issuer for performance
const jwksCache: Record<string, ReturnType<typeof createRemoteJWKSet>> = {};

async function verifyClerkToken(token: string, env: Env): Promise<JWTPayload | null> {
  const issuer = env.CLERK_JWT_ISSUER;
  if (!issuer) {
    console.error('[AUTH] CLERK_JWT_ISSUER not set');
    return null;
  }

  const jwksUrl = env.CLERK_JWKS_URL || `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`;

  // Initialize JWKS fetcher with aggressive caching to prevent intermittent failures
  if (!jwksCache[jwksUrl]) {
    jwksCache[jwksUrl] = createRemoteJWKSet(new URL(jwksUrl), {
      cacheMaxAge: 3600000, // Cache keys for 1 hour to avoid repeated fetches
      cooldownDuration: 30000, // Wait 30s before retrying failed fetches
    });
  }

  const jwks = jwksCache[jwksUrl];

  try {
    const { payload} = await jwtVerify(token, jwks, {
      issuer,
      clockTolerance: 30, // Allow 30 second clock skew (Clerk tokens expire in 60s)
    });
    return payload;
  } catch (err) {
    console.error('[AUTH] JWT verification failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

// Derive a stable user identifier in this order:
// 1) Clerk Bearer token (sub)
// 2) Cloudflare Access email header
// 3) x-user override (dev/testing)
// 4) dev@local in development
// 5) anonymous
export async function getUserId(request: Request, env: Env): Promise<string> {
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    const payload = await verifyClerkToken(token, env);
    if (payload?.sub) return payload.sub;
  }

  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (email) return email.toLowerCase();

  const override = request.headers.get('x-user');
  if (override) return override.toLowerCase();

  if (env.ENVIRONMENT === 'development') return 'dev@local';
  return 'anonymous';
}
