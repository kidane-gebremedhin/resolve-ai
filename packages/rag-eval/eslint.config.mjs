import node from "@csb/config/eslint/node";

export default [
  ...node,
  {
    // This package IS a CLI: its entire output is a metric table a human reads
    // in a terminal. Routing that through the API's structured logger would put
    // the report inside JSON log lines, which is the opposite of the point.
    files: ["src/cli.ts"],
    rules: { "no-console": "off" },
  },
  { ignores: ["reports/**", ".cache/**"] },
];
