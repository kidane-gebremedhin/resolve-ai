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
});
