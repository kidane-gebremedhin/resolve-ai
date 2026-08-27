// Browser flavour: base rules plus DOM globals. Used by the widget, the embed
// loader and the shared UI package.
import globals from "globals";
import base from "./base.js";

export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
  },
];
