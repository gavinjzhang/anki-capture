#!/bin/bash
# Check if E2E environment is properly configured

echo "🔍 Checking E2E Test Environment..."
echo ""

MISSING=0

# Check root .env for Clerk secret key
if [ -f ".env" ]; then
  if grep -q "CLERK_SECRET_KEY=" .env && grep -q "CLERK_PUBLISHABLE_KEY=" .env; then
    echo "✅ Root .env has Clerk keys"
  else
    echo "❌ Root .env is missing CLERK_SECRET_KEY or CLERK_PUBLISHABLE_KEY"
    MISSING=1
  fi
else
  echo "❌ Root .env file not found"
  MISSING=1
fi

# Check frontend .env.local for Vite Clerk key
if [ -f "frontend/.env.local" ]; then
  if grep -q "VITE_CLERK_PUBLISHABLE_KEY=" frontend/.env.local; then
    echo "✅ frontend/.env.local has VITE_CLERK_PUBLISHABLE_KEY"
  else
    echo "❌ frontend/.env.local is missing VITE_CLERK_PUBLISHABLE_KEY"
    MISSING=1
  fi
else
  echo "❌ frontend/.env.local file not found"
  MISSING=1
fi

# Check if @clerk/testing is installed
if [ -d "node_modules/@clerk/testing" ]; then
  echo "✅ @clerk/testing is installed"
else
  echo "❌ @clerk/testing not installed (run: npm install)"
  MISSING=1
fi

# Check if Playwright is installed
if [ -d "node_modules/@playwright/test" ]; then
  echo "✅ @playwright/test is installed"
else
  echo "❌ @playwright/test not installed (run: npm install)"
  MISSING=1
fi

echo ""

if [ $MISSING -eq 0 ]; then
  echo "✅ Environment is ready for E2E tests!"
  echo ""
  echo "Run tests with: npx playwright test"
  exit 0
else
  echo "❌ Environment setup incomplete"
  echo ""
  echo "📖 See e2e/README.md for setup instructions"
  echo ""
  echo "Quick setup:"
  echo "  1. Create .env in root:"
  echo "     CLERK_SECRET_KEY=sk_test_..."
  echo "     CLERK_PUBLISHABLE_KEY=pk_test_..."
  echo ""
  echo "  2. Create frontend/.env.local:"
  echo "     VITE_CLERK_PUBLISHABLE_KEY=pk_test_..."
  echo ""
  echo "  3. Run: npm install"
  exit 1
fi
