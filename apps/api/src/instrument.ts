// Sentry bootstrap — MUST be the first thing the process loads.
//
// The Node SDK instruments modules (http, express, mongoose, …) by patching
// them as they are required. Anything imported before `Sentry.init()` runs is
// therefore never instrumented, which is why `index.ts` imports this file on
// its very first line and why this file imports nothing from the app besides
// dotenv (loading `config/env.js` here would pull half the app in early).
//
// No DSN → the SDK is left uninitialised and every `Sentry.*` call becomes a
// no-op, so local dev and self-hosted deploys run untouched without the var.
import "dotenv/config";
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    // Set by CI to the image SHA so stack traces map to a known build.
    release: process.env.SENTRY_RELEASE,
    // Errors only — performance tracing is deliberately off (see
    // __specs/35-error-monitoring-sentry.md). Raise this to sample transactions.
    tracesSampleRate: 0,
    // Never attach cookies, auth headers or request bodies to an event: this API
    // carries JWTs, contact PII and customer conversation content.
    sendDefaultPii: false,
  });
} else {
  // eslint-disable-next-line no-console
  console.warn("[api] SENTRY_DSN not set — error monitoring is disabled.");
}
