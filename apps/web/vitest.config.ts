import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json. Next resolves it; vitest does
    // not, so without this every import of `@/lib/...` fails at collection.
    alias: [{ find: /^@\/(.*)$/, replacement: path.resolve(here, "src/$1") }],
  },
  // The app's PostCSS config is Tailwind v4, which vitest cannot load and has no
  // reason to: nothing under test renders a stylesheet. Overriding it here stops
  // collection failing on a config that is irrelevant to these tests.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
  },
});
