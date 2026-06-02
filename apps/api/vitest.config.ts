import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 300_000,
    include: ["src/**/*.test.ts"],
  },
});
