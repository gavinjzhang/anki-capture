import { Env } from '../types';
import { getUserId } from './auth';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory rate limit cache (resets on worker restart)
// For production scale, consider Durable Objects or Workers KV
const rateLimitCache = new Map<string, RateLimitEntry>();

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  upload: { maxRequests: 10, windowMs: 60 * 1000 }, // 10 uploads per minute
  regenerate: { maxRequests: 5, windowMs: 60 * 1000 }, // 5 regenerations per minute
  retry: { maxRequests: 5, windowMs: 60 * 1000 }, // 5 retries per minute
  approve: { maxRequests: 20, windowMs: 60 * 1000 }, // 20 approvals per minute
  generate: { maxRequests: 10, windowMs: 60 * 1000 }, // 10 generations per minute
};

/**
 * Check if a user has exceeded rate limits for a specific operation
 * @returns true if rate limit is exceeded, false otherwise
 */
export async function isRateLimited(
  request: Request,
  env: Env,
  operation: keyof typeof RATE_LIMITS
): Promise<{ limited: boolean; userId: string | null }> {
  // Skip rate limiting in development
  if (env.ENVIRONMENT === 'development') {
    return { limited: false, userId: null };
  }

  const userId = await getUserId(request, env);
  if (!userId) {
    return { limited: false, userId: null };
  }

  const config = RATE_LIMITS[operation];
  const key = `${userId}:${operation}`;
  const now = Date.now();

  // Clean up expired entries periodically
  if (Math.random() < 0.01) {
    for (const [k, entry] of rateLimitCache.entries()) {
      if (entry.resetAt < now) {
        rateLimitCache.delete(k);
      }
    }
  }

  const entry = rateLimitCache.get(key);

  // If no entry or window expired, create new entry
  if (!entry || entry.resetAt < now) {
    rateLimitCache.set(key, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return { limited: false, userId };
  }

  // Increment counter
  entry.count++;

  // Check if limit exceeded
  if (entry.count > config.maxRequests) {
    return { limited: true, userId };
  }

  return { limited: false, userId };
}

/**
 * Get remaining requests for a user operation
 */
export function getRateLimitInfo(
  userId: string,
  operation: keyof typeof RATE_LIMITS
): { remaining: number; resetAt: number } {
  const config = RATE_LIMITS[operation];
  const key = `${userId}:${operation}`;
  const entry = rateLimitCache.get(key);
  const now = Date.now();

  if (!entry || entry.resetAt < now) {
    return {
      remaining: config.maxRequests,
      resetAt: now + config.windowMs,
    };
  }

  return {
    remaining: Math.max(0, config.maxRequests - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(
  headers: Headers,
  userId: string | null,
  operation: keyof typeof RATE_LIMITS
): void {
  if (!userId) return;

  const info = getRateLimitInfo(userId, operation);
  const config = RATE_LIMITS[operation];

  headers.set('X-RateLimit-Limit', config.maxRequests.toString());
  headers.set('X-RateLimit-Remaining', info.remaining.toString());
  headers.set('X-RateLimit-Reset', Math.ceil(info.resetAt / 1000).toString());
}
