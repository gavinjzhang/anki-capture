# Security Guide

This document outlines security best practices and configuration for the Anki Capture application.

## Table of Contents
1. [Secrets Management](#secrets-management)
2. [CORS Configuration](#cors-configuration)
3. [Clerk Authentication Hardening](#clerk-authentication-hardening)
4. [Rate Limiting](#rate-limiting)
5. [File Access Security](#file-access-security)
6. [Webhook Security](#webhook-security)

## Secrets Management

### Required Secrets

All sensitive values must be set using Wrangler secrets, **never** committed to wrangler.toml:

```bash
cd worker

# Required: Modal webhook authentication
npx wrangler secret put MODAL_WEBHOOK_SECRET
# Generate with: openssl rand -base64 32

# Required: File URL signing for R2 access
npx wrangler secret put FILE_URL_SIGNING_SECRET
# Generate with: openssl rand -base64 32

# For production environment
npx wrangler secret put MODAL_WEBHOOK_SECRET --env production
npx wrangler secret put FILE_URL_SIGNING_SECRET --env production
```

### Modal Secrets

The same `MODAL_WEBHOOK_SECRET` must be configured in Modal:

```bash
modal secret create anki-capture-secrets \
  OPENAI_API_KEY=sk-... \
  GOOGLE_CREDENTIALS_JSON='{"type": "service_account", ...}' \
  MODAL_WEBHOOK_SECRET=<same-secret-as-worker> \
  GCP_TTS_AR_VOICE=ar-XA-Wavenet-B \
  GCP_TTS_RU_VOICE=ru-RU-Wavenet-C
```

## CORS Configuration

### Production Setup

Set `ALLOWED_ORIGINS` in wrangler.toml or via Cloudflare dashboard:

```toml
[env.production]
vars = {
  ENVIRONMENT = "production",
  ALLOWED_ORIGINS = "https://anki-capture.pages.dev,https://your-custom-domain.com"
}
```

**Important**:
- Use comma-separated list for multiple origins
- Always use HTTPS in production
- Do not include trailing slashes
- Development automatically allows localhost origins

### Testing CORS

```bash
# Should succeed with your origin
curl -H "Origin: https://anki-capture.pages.dev" \
  -H "Access-Control-Request-Method: GET" \
  -X OPTIONS https://your-worker.workers.dev/api/health

# Should fail with different origin (production only)
curl -H "Origin: https://evil.com" \
  -H "Access-Control-Request-Method: GET" \
  -X OPTIONS https://your-worker.workers.dev/api/health
```

## Clerk Authentication Hardening

### Dashboard Configuration

1. **Sign in to Clerk Dashboard** → Your Application → Configure

2. **Allowed Origins** (Settings → Allowed origins):
   - Add: `https://anki-capture.pages.dev` (your production frontend)
   - Add: `http://localhost:5173` (development only)
   - Remove: Any wildcard origins (`*`)

3. **Allowed Redirect URLs** (Settings → Paths):
   - Add: `https://anki-capture.pages.dev/*`
   - Add: `http://localhost:5173/*` (development only)
   - Remove: Any untrusted domains

4. **JWT Template** (JWT Templates → Default):
   - Ensure "Token lifetime" is reasonable (e.g., 60 seconds)
   - Verify "Claims" includes `sub` (user ID)
   - Enable "Token refresh" for better UX

5. **Session Configuration** (Sessions):
   - Set "Inactivity timeout" (e.g., 7 days)
   - Enable "Multi-session handling" if needed
   - Consider enabling "Sign out from all devices"

6. **Production Configuration**:
   - Update `CLERK_JWT_ISSUER` in wrangler.toml with your production issuer
   - Example: `https://your-app.clerk.accounts.dev`
   - Ensure it matches the `iss` claim in Clerk JWTs

### Testing Authentication

```bash
# Get a token from your frontend (check localStorage or network tab)
TOKEN="eyJhbGci..."

# Test authenticated endpoint
curl -H "Authorization: Bearer $TOKEN" \
  https://your-worker.workers.dev/api/phrases

# Should return 401 without token
curl https://your-worker.workers.dev/api/phrases
```

## Rate Limiting

### Default Limits

Per-user rate limits (per minute):
- **Uploads**: 10 requests
- **Regenerate Audio**: 5 requests
- **Retry**: 5 requests
- **Approve**: 20 requests

### Rate Limit Headers

All rate-limited endpoints return:
```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1234567890
```

### Customizing Limits

Edit `worker/src/lib/rateLimit.ts`:

```typescript
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  upload: { maxRequests: 20, windowMs: 60 * 1000 }, // 20/min
  // ...
};
```

### Rate Limit Bypass (Development)

Rate limiting is automatically disabled when `ENVIRONMENT=development`.

## File Access Security

### Signed URLs

All R2 file access requires either:
1. **Signed URL** with `?e=<timestamp>&sig=<hmac>`
2. **Authenticated request** with Bearer token matching file namespace

### URL Signing Process

```typescript
// Short-lived (10 min) for UI display
const signedUrl = await buildAbsoluteSignedUrl(env, origin, fileKey, 600);

// Long-lived (24h) for Modal processing
const signedUrl = await buildAbsoluteSignedUrl(env, origin, fileKey, 86400);
```

### Namespace Isolation

- Files are organized by user: `{user_id}/original/...`, `{user_id}/audio/...`
- Authenticated users can only access files in their namespace
- Legacy files (`original/...`, `audio/...`) are denied access

### Testing File Access

```bash
# Should fail without signature or auth
curl https://your-worker.workers.dev/api/files/user123/audio/abc.mp3
# Returns: 403 Forbidden

# Should succeed with valid signature
curl "https://your-worker.workers.dev/api/files/user123/audio/abc.mp3?e=1234567890&sig=..."

# Should succeed with authentication
curl -H "Authorization: Bearer $TOKEN" \
  https://your-worker.workers.dev/api/files/user123/audio/abc.mp3
```

## Webhook Security

### Modal → Worker Webhook

The `/api/webhook/modal` endpoint requires Bearer token authentication:

```typescript
Authorization: Bearer <MODAL_WEBHOOK_SECRET>
```

### Security Measures

1. **Secret must be strong**: Use `openssl rand -base64 32`
2. **Rotate regularly**: Update in both Worker and Modal secrets
3. **Monitor failures**: Check logs for 401 responses

### Testing Webhook Auth

```bash
# Should fail without auth
curl -X POST https://your-worker.workers.dev/api/webhook/modal
# Returns: 401 Unauthorized

# Should succeed with correct secret
curl -X POST \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{"phrase_id":"test","success":true}' \
  https://your-worker.workers.dev/api/webhook/modal
```

## Security Checklist

Before deploying to production:

- [ ] All secrets set via `wrangler secret put` (not in wrangler.toml)
- [ ] `ALLOWED_ORIGINS` configured with production frontend URL
- [ ] `FILE_URL_SIGNING_SECRET` set and strong (32+ bytes)
- [ ] `MODAL_WEBHOOK_SECRET` matches between Worker and Modal
- [ ] Clerk allowed origins/redirects configured
- [ ] Clerk JWT issuer matches production environment
- [ ] Rate limiting tested and appropriate for your use case
- [ ] File access tested with both signed URLs and auth
- [ ] Webhook authentication tested
- [ ] CORS tested from allowed and disallowed origins

## Incident Response

### If Secrets Are Compromised

1. **Rotate immediately**:
   ```bash
   openssl rand -base64 32  # Generate new secret
   wrangler secret put FILE_URL_SIGNING_SECRET --env production
   wrangler secret put MODAL_WEBHOOK_SECRET --env production
   modal secret update anki-capture-secrets MODAL_WEBHOOK_SECRET=<new-secret>
   ```

2. **Check logs** for suspicious activity:
   - Cloudflare Workers → Logs
   - Look for 401/403 responses
   - Check for unusual rate limit violations

3. **Revoke user sessions** (if auth compromised):
   - Clerk Dashboard → Sessions → Revoke all sessions
   - Users will need to sign in again

### Monitoring

Set up alerts for:
- 401/403 spike (potential attack)
- 429 spike (rate limit violations)
- 5xx errors (service issues)
- Unusual upload patterns

Use Cloudflare Logpush or Workers Analytics for monitoring.

## Resources

- [Cloudflare Workers Security Best Practices](https://developers.cloudflare.com/workers/platform/security/)
- [Clerk Security Documentation](https://clerk.com/docs/security/overview)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
