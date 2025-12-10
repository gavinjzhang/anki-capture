import { Env } from '../types';

// Derive a stable user identifier from Cloudflare Access headers.
// Fallbacks: X-User for local dev, or a fixed 'dev' user in development.
export function getUserId(request: Request, env: Env): string {
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (email) return email.toLowerCase();

  // Local/dev override for testing multi-user
  const override = request.headers.get('x-user');
  if (override) return override.toLowerCase();

  // Default to a single dev user to avoid exploding data during local runs
  if (env.ENVIRONMENT === 'development') return 'dev@local';

  // If Access is not enabled, group under anonymous user
  return 'anonymous';
}

