import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/widget.ts",
      output: {
        entryFileNames: "widget.js",
        format: "iife",
        inlineDynamicImports: true,
      },
    },
  },
  // preview (used by the dev script) must allow cross-origin requests so the
  // widget.js can be loaded from any test page or customer site.
  preview: {
    port: 3002,
    cors: true,
  },
});
