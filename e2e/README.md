# E2E Tests Setup

## Prerequisites

The E2E tests use Clerk for authentication. You need to set up Clerk keys before running tests.

### Local Development

1. Get your Clerk keys from https://dashboard.clerk.com
2. Create `frontend/.env.local` with:
   ```bash
   VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
   ```

3. Create `.env` in the root directory with:
   ```bash
   CLERK_SECRET_KEY=sk_test_...
   CLERK_PUBLISHABLE_KEY=pk_test_...
   ```

4. Run tests:
   ```bash
   npx playwright test
   ```

### CI/CD (GitHub Actions)

Add these secrets to your GitHub repository:

1. Go to Settings → Secrets and variables → Actions
2. Add repository secrets:
   - `CLERK_PUBLISHABLE_KEY` - Your Clerk publishable key (pk_test_...)
   - `CLERK_SECRET_KEY` - Your Clerk secret key (sk_test_...)

### Getting Clerk Test Keys

1. Sign up at https://clerk.com
2. Create a new application for testing
3. Go to **API Keys** in the Clerk dashboard
4. Copy the **Publishable Key** and **Secret Key**
5. For testing, use the **Development** keys (not Production)

## Why Clerk?

The app uses Clerk for authentication. E2E tests need real authentication to test the full user flow. The `@clerk/testing` package provides utilities to:
- Set up test users
- Inject auth tokens into Playwright
- Skip the actual sign-in UI during tests

## Running Tests Without Clerk (Fallback)

If you don't want to set up Clerk, you can:

1. Skip E2E tests:
   ```bash
   npm run test:worker
   npm run test:frontend
   ```

2. Or mock Clerk in tests (requires code changes - see TODO)

## Test Architecture

```
e2e/
├── global-setup.ts       # Configures Clerk for all tests
├── smoke.spec.ts         # Critical user flows
└── README.md            # This file

playwright.config.ts      # Playwright configuration
```

Each test:
1. `global-setup.ts` calls `clerkSetup()` once
2. `beforeEach` calls `setupClerkTestingToken()` to inject auth
3. Test runs with authenticated user
4. Playwright cleans up automatically
