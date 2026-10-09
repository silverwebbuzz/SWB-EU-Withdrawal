import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so the React Router plugin does not run in tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Integration tests share one MySQL test database.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
