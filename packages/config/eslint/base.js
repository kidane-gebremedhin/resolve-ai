// Shared base ESLint config (flat config format).
//
// Every workspace that lints TypeScript extends this. Before it existed, four
// workspaces declared a `lint` script but shipped no config at all, so
// `turbo run lint` failed outright and the CI lint job was red on every PR —
// which meant nobody read CI, including the type-check job that did work.
//
// Deliberately calibrated for a codebase adopting lint late: correctness rules
// that catch real bugs are ERRORS, while stylistic and cleanup rules are
// WARNINGS. ESLint only exits non-zero on errors, so the gate goes green and
// stays meaningful, and the warning backlog can be burned down without holding
// up every PR. Tighten these to "error" as the count drops.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // --- real defects -------------------------------------------------
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "@typescript-eslint/no-misused-new": "error",
      // Awaiting a non-promise usually means a missing await further up.
      "no-constant-condition": ["error", { checkLoops: false }],

      // --- cleanup: real signal, but not worth blocking a merge ---------
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // The API layer logs through winston; console is a warning, not a ban,
      // because scripts/ and migrations legitimately print.
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // --- off: wrong for this codebase ---------------------------------
      // Base rule misfires on TS overloads and enums; the TS variant above covers it.
      "no-unused-vars": "off",
      // `catch (err) { ... }` with a re-throw is idiomatic here.
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
