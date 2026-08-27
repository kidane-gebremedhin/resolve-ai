import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Mirrors the `@api/*` path in tsconfig.json. tsx reads tsconfig paths;
      // vitest does not, so without this every module that imports production
      // code fails to resolve at collection time.
      {
        find: /^@api\/(.*)\.js$/,
        replacement: path.resolve(here, "../../apps/api/src/$1.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["src/test-setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
