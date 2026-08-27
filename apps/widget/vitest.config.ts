import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's PostCSS config is Tailwind v4, which vitest cannot load and has no
  // reason to: nothing under test renders a stylesheet. Overriding it here stops
  // collection failing on a config that is irrelevant to these tests.
  css: { postcss: { plugins: [] } },
  test: {
    // The logic under test is pure: a reducer and a session codec. Neither
    // needs a DOM, and adding jsdom would buy nothing but start-up cost.
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
  },
});
