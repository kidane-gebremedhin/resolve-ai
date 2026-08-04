// Server-side counterpart of /sentry-example-page: throws inside a Next.js route
// handler so the Node-runtime SDK (sentry.server.config.ts + the `onRequestError`
// hook in instrumentation.ts) can be verified independently of the browser SDK
// and of the Express API.
export const dynamic = 'force-dynamic';

class SentryExampleApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SentryExampleApiError';
  }
}

export function GET() {
  throw new SentryExampleApiError(
    'Sentry frontend-server test error (GET /api/sentry-example-api)',
  );
}
