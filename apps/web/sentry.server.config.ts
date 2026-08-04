// Sentry init for the Next.js Node.js runtime (server components, route
// handlers, server actions). Imported from `src/instrumentation.ts` → register().
//
// Unlike the client config this reads a RUNTIME env var, so the DSN can be
// changed on the Coolify service without a rebuild — but keep it identical to
// NEXT_PUBLIC_SENTRY_DSN so browser and server errors land in one project.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    // Errors only — see __specs/35-error-monitoring-sentry.md.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
