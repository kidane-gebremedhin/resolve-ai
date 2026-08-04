// Browser-side Sentry init. Next.js loads this file before any app code runs in
// the client (it replaces the old `sentry.client.config.ts`), so errors thrown
// during hydration are captured too.
//
// The DSN is NEXT_PUBLIC_*, i.e. inlined at BUILD time — it must be present as a
// build arg in apps/web/Dockerfile, not just at runtime. Without it the SDK is
// never initialised and every Sentry call is a no-op.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    // Errors only — no performance tracing and no session replay
    // (see __specs/35-error-monitoring-sentry.md).
    tracesSampleRate: 0,
    // Dashboard users are identifiable; don't ship IPs/cookies with events.
    sendDefaultPii: false,
  });
}

// Lets Sentry tie an error to the navigation that was in flight when it
// happened. Next.js calls this on every App Router transition.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
