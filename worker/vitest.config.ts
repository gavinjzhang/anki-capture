import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // Test-specific bindings
          bindings: {
            MODAL_WEBHOOK_SECRET: "test-webhook-secret",
            FILE_URL_SIGNING_SECRET: "test-signing-secret",
            CLERK_JWT_ISSUER: "https://test.clerk.accounts.dev",
            ENVIRONMENT: "test",
          },
        },
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.ts",
        "**/__tests__/",
        "src/__tests__/setup.ts",
        "src/__tests__/factories.ts",
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 70,
        statements: 75,
      },
    },
  },
});
