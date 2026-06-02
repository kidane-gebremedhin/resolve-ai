// Single source of truth for branding strings. Override at build/runtime with
// `NEXT_PUBLIC_APP_NAME` and friends so we can rebrand without grepping for
// "NextSaaS" / "Helio" across the codebase.

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Helio";

// Short tagline used after the app name in metadata.
export const APP_TAGLINE =
  process.env.NEXT_PUBLIC_APP_TAGLINE ?? "AI customer support for modern websites";

// Used by the marketing footer copyright line.
export const APP_LEGAL_NAME =
  process.env.NEXT_PUBLIC_APP_LEGAL_NAME ?? `${APP_NAME} AI, Inc.`;
