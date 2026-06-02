// Shared base ESLint config (flat config format).
// Each app/package extends this and overrides per its toolchain.
export default [
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-unused-vars": "off",
    },
  },
];
