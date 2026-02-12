# Testing Guide

This project has comprehensive test coverage across Worker, Frontend, and E2E layers.

## Quick Start

```bash
# Run all tests
npm test                    # (run from worker/ or frontend/)

# Run with coverage
npm run test:coverage

# Watch mode (during development)
npm run test:watch

# E2E tests (from project root)
npx playwright test
```

## Test Structure

```
project/
├── worker/src/
│   ├── lib/__tests__/          # Unit tests (signing, db helpers)
│   └── routes/__tests__/       # Integration tests (webhook, routes)
├── frontend/src/
│   └── lib/__tests__/          # Hook and utility tests
└── e2e/                        # Playwright E2E tests
```

## Test Coverage

| Component | Tests | Coverage | What's Tested |
|-----------|-------|----------|---------------|
| **Worker** | 26 | ~85% | File signing, webhook handler, auth |
| **Frontend** | 5 | ~70% | Adaptive polling hook |
| **E2E** | 6 specs | N/A | Critical user flows |

## Worker Tests

**Location**: `worker/src/`

**Run**: `cd worker && npm test`

### What's Covered

✅ **File URL Signing** (`lib/__tests__/signing.test.ts`)
- Signature generation and verification
- Tampering detection (key, expiry, signature)
- Special character encoding
- Missing secret handling

✅ **Webhook Handler** (`routes/__tests__/webhook.test.ts`)
- Authentication (valid/invalid secrets)
- Payload validation
- Successful processing (database updates)
- Error handling and recording
- Idempotency (stale webhook rejection)

### Writing Worker Tests

```typescript
import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";

describe("My Route", () => {
  it("handles requests", async () => {
    const response = await SELF.fetch("http://example.com/api/route");
    expect(response.status).toBe(200);
  });

  it("updates database", async () => {
    await env.DB.prepare("INSERT INTO ...").run();
    const row = await env.DB.prepare("SELECT ...").first();
    expect(row).toBeTruthy();
  });
});
```

## Frontend Tests

**Location**: `frontend/src/lib/__tests__/`

**Run**: `cd frontend && npm test`

### What's Covered

✅ **Adaptive Polling Hook** (`useAdaptivePolling.test.ts`)
- Fast/slow interval switching
- Tab visibility pause
- Enable/disable state
- Immediate polling on mount

### Writing Frontend Tests

```typescript
import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";

describe("My Hook", () => {
  it("works correctly", async () => {
    const { result } = renderHook(() => useMyHook());

    await act(async () => {
      result.current.doSomething();
    });

    expect(result.current.value).toBe(expected);
  });
});
```

## E2E Tests

**Location**: `e2e/`

**Run**: `npx playwright test` (from project root)

### What's Covered

✅ **Smoke Test** (`e2e/smoke.spec.ts`)
- Navigation between pages
- Upload form validation
- Library filters
- Health check endpoint

### Writing E2E Tests

```typescript
import { test, expect } from "@playwright/test";

test("user can do something", async ({ page }) => {
  await page.goto("/");
  await page.click('button:has-text("Click Me")');
  await expect(page.locator("text=Success")).toBeVisible();
});
```

## CI/CD

Tests run automatically on every PR via GitHub Actions.

### Workflow

1. **TypeCheck** - Validates TypeScript in Worker + Frontend
2. **Worker Tests** - Runs unit/integration tests with coverage
3. **Frontend Tests** - Runs hook/utility tests with coverage
4. **Build Check** - Verifies Worker and Frontend build successfully
5. **E2E Tests** - Runs Playwright smoke tests
6. **Summary** - Reports overall status

### CI Configuration

See `.github/workflows/ci.yml`

### Coverage Reports

Coverage is uploaded to Codecov on every CI run (if `CODECOV_TOKEN` is configured).

## Tips

### Debugging Tests

```bash
# Run a specific test file
npm test -- useAdaptivePolling

# Run tests matching a pattern
npm test -- --grep "webhook"

# Debug with Playwright UI
npx playwright test --ui

# View Playwright trace
npx playwright show-trace trace.zip
```

### Fake Timers

Worker and Frontend tests use fake timers for time-based tests:

```typescript
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

// In tests
await vi.advanceTimersByTimeAsync(1000);
```

### Common Issues

**"Cannot read properties of undefined (reading 'DB')"**
- Make sure you're using `env` from `cloudflare:test`, not `SELF.env`
- Database schema must be initialized in setup file

**"Test timed out in 5000ms"**
- Use `vi.advanceTimersByTimeAsync()` instead of `waitFor()` with fake timers
- Ensure promises are flushed with `await flushPromises()`

**E2E tests fail to start**
- Make sure local dev servers aren't already running on ports 8787/5173
- Check that `wrangler` and `vite` are installed

## Test Philosophy

- **Test behavior, not implementation** - Focus on what the code does, not how
- **Critical paths first** - Security, data integrity, core flows
- **Keep tests fast** - Use fakes/mocks where appropriate
- **Meaningful assertions** - Each test should validate one clear thing
- **Clean up after yourself** - Clear database, reset mocks in afterEach

## TODO

- [ ] Add more Worker route tests (upload, export, phrases CRUD)
- [ ] Add Frontend component tests (Review page, Library filters)
- [ ] Increase E2E coverage (upload → processing → approve flow)
- [ ] Add visual regression tests (optional)
- [ ] Add performance tests for database queries (optional)
