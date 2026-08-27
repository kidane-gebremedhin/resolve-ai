// Node/server flavour: base rules plus the Node global environment.
// Used by the API and any other non-DOM workspace.
import globals from "globals";
import base from "./base.js";

export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
  },
];
