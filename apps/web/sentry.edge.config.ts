// Sentry init for the Edge runtime (middleware and any `export const runtime =
// 'edge'` route). Imported from `src/instrumentation.ts` → register().
//
// The app has no edge routes today; this exists so adding one doesn't silently
// lose its errors.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
