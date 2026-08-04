'use client';

// Last-resort error boundary: catches errors thrown while rendering the root
// layout or any page that no nested error.tsx handled. React swallows those
// after showing this fallback, so Sentry only learns about them if we report
// them here explicitly.
//
// It replaces the whole document, hence its own <html>/<body>.
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-white p-6 text-neutral-900">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-neutral-600">
            The error has been reported and we&apos;re looking into it.
            {error.digest ? (
              <>
                {' '}
                Reference: <code className="font-mono">{error.digest}</code>
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-5 text-sm font-medium text-white transition hover:bg-neutral-700"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
