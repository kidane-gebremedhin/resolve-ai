import node from "@csb/config/eslint/node";

export default [
  ...node,
  { ignores: ["dist/**", "src/migrations/**"] },
];
