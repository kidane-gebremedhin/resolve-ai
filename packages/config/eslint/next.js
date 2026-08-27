// Next.js flavour: eslint-config-next + the shared base + this monorepo's
// policy on the React 19 lint rules.
//
// Lives here rather than being copy-pasted into apps/web, apps/admin and
// apps/widget, which is how those three configs had already started to drift.
// The react-hooks rules below can only be set where the plugin is loaded, so
// they belong in this preset and not in ./base.js — a workspace without React
// (the API, shared-types) fails to start if it sees them.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import base from "./base.js";

export default function nextConfig(extraIgnores = []) {
  return defineConfig([
    ...nextVitals,
    ...nextTs,
    ...base,
    {
      rules: {
        // react-hooks v6 (shipped with eslint-config-next 16) fires on patterns
        // this codebase uses throughout: reading localStorage or a media query
        // in a mount effect — the only place a client-only value can be read
        // after SSR — and reading a ref during render to pass a non-rendering
        // value down. Worth fixing deliberately, component by component; not
        // worth blocking every merge on, and not worth scattering per-site
        // disable comments through the UI. Warnings until the backlog clears.
        "react-hooks/set-state-in-effect": "warn",
        "react-hooks/refs": "warn",
        // Same category, same reasoning: each of these flags a real pattern
        // worth revisiting (JSX built inside try/catch won't have render errors
        // caught; an impure call during render; memoization the React Compiler
        // can't preserve), but all of them predate the linter and none is a
        // live defect. Visible as warnings, fixed on purpose rather than under
        // merge pressure.
        "react-hooks/error-boundaries": "warn",
        "react-hooks/purity": "warn",
        "react-hooks/preserve-manual-memoization": "warn",
      },
    },
    globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ...extraIgnores]),
  ]);
}
