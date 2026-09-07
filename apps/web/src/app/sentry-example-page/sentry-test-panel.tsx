'use client';

// Production smoke test for Sentry. Each button exercises ONE reporting path, so
// when something stops arriving in Sentry you can tell which layer broke:
//
//   browser SDK        → instrumentation-client.ts
//   Next.js server SDK → sentry.server.config.ts + onRequestError
//   Express API SDK    → apps/api/src/instrument.ts + setupExpressErrorHandler
//
// Nothing here is gated: the page must work on a fresh deploy before anyone has
// logged in. The API-side endpoints it calls are rate limited to 5/min per IP.
import * as Sentry from '@sentry/nextjs';
import { useEffect, useState } from 'react';
import { Button } from '@csb/ui';
import { API_URL } from '@/lib/app-urls';

type Status = 'idle' | 'running' | 'ok' | 'failed';

type TestId =
  | 'browser-handled'
  | 'browser-uncaught'
  | 'browser-rejection'
  | 'browser-render'
  | 'next-server'
  | 'api-error'
  | 'api-message';

type Result = { status: Status; detail?: string };

const GROUPS: Array<{
  title: string;
  layer: string;
  tests: Array<{ id: TestId; name: string; description: string; danger?: boolean }>;
}> = [
  {
    title: 'Browser',
    layer: 'addisaipro-frontend · client',
    tests: [
      {
        id: 'browser-handled',
        name: 'Handled exception',
        description:
          'Reports an exception explicitly and waits for the flush. The only test that can confirm delivery in-page — it returns the Sentry event ID.',
      },
      {
        id: 'browser-uncaught',
        name: 'Uncaught exception',
        description:
          "Throws outside React so the global window.onerror handler catches it. Nothing changes on screen; check Sentry.",
      },
      {
        id: 'browser-rejection',
        name: 'Unhandled promise rejection',
        description: 'Rejects a promise nobody awaits — the unhandledrejection path.',
      },
      {
        id: 'browser-render',
        name: 'React render crash',
        description:
          'Throws during render. Replaces this page with the global-error boundary — reload afterwards to come back.',
        danger: true,
      },
    ],
  },
  {
    title: 'Next.js server',
    layer: 'addisaipro-frontend · server',
    tests: [
      {
        id: 'next-server',
        name: 'Route handler 500',
        description:
          'GET /api/sentry-example-api throws inside the Node runtime. Verifies the onRequestError hook.',
      },
    ],
  },
  {
    title: 'Express API',
    layer: 'addisaipro-backend',
    tests: [
      {
        id: 'api-error',
        name: 'Unhandled 500',
        description:
          'GET /debug-sentry throws in the API. The 500 response carries the Sentry event ID it created.',
      },
      {
        id: 'api-message',
        name: 'Handled message',
        description:
          'GET /debug-sentry/message reports without failing the request — a non-destructive connectivity check.',
      },
    ],
  },
];

export default function SentryTestPanel() {
  const [results, setResults] = useState<Partial<Record<TestId, Result>>>({});
  const [clientReady, setClientReady] = useState(false);
  const [crash, setCrash] = useState(false);

  // `getClient()` is only meaningful after hydration, and reading it during
  // render would desync the server markup.
  useEffect(() => {
    setClientReady(Boolean(Sentry.getClient()));
  }, []);

  // Throwing here (rather than in the click handler) is what makes this a real
  // render error, which is the only kind global-error.tsx sees.
  if (crash) {
    throw new Error('Sentry frontend test error (React render)');
  }

  const set = (id: TestId, result: Result) =>
    setResults((prev) => ({ ...prev, [id]: result }));

  async function run(id: TestId) {
    set(id, { status: 'running' });

    switch (id) {
      case 'browser-handled': {
        const eventId = Sentry.captureException(
          new Error('Sentry frontend test error (handled, browser)'),
        );
        // flush() resolves false when the event could not be delivered — an ad
        // blocker or a wrong DSN shows up here rather than as silence.
        const delivered = await Sentry.flush(5000);
        set(id, {
          status: delivered ? 'ok' : 'failed',
          detail: delivered
            ? `Delivered · event ${eventId}`
            : 'Flush timed out — the event did not reach Sentry (ad blocker or bad DSN?)',
        });
        return;
      }

      case 'browser-uncaught': {
        set(id, { status: 'ok', detail: 'Thrown — check Sentry for "uncaught, browser"' });
        // setTimeout takes the throw out of React's call stack, so it surfaces
        // as a genuine uncaught error on window.
        setTimeout(() => {
          throw new Error('Sentry frontend test error (uncaught, browser)');
        }, 0);
        return;
      }

      case 'browser-rejection': {
        set(id, { status: 'ok', detail: 'Rejected — check Sentry for "unhandled rejection"' });
        void Promise.reject(new Error('Sentry frontend test error (unhandled rejection)'));
        return;
      }

      case 'browser-render': {
        setCrash(true);
        return;
      }

      case 'next-server': {
        try {
          const res = await fetch('/api/sentry-example-api', { cache: 'no-store' });
          set(id, {
            status: res.status === 500 ? 'ok' : 'failed',
            detail:
              res.status === 500
                ? 'Server threw as expected — check Sentry'
                : `Expected HTTP 500, got ${res.status}`,
          });
        } catch (err) {
          set(id, { status: 'failed', detail: describe(err) });
        }
        return;
      }

      case 'api-error': {
        try {
          const res = await fetch(`${API_URL}/debug-sentry`, { cache: 'no-store' });
          const body = (await res.json().catch(() => null)) as {
            error?: { eventId?: string };
          } | null;
          const eventId = body?.error?.eventId;
          set(id, {
            status: res.status === 500 ? 'ok' : 'failed',
            detail:
              res.status === 500
                ? eventId
                  ? `API threw as expected · event ${eventId}`
                  : 'API threw as expected, but returned no event ID — is SENTRY_DSN set on the API?'
                : `Expected HTTP 500, got ${res.status}`,
          });
        } catch (err) {
          set(id, { status: 'failed', detail: describe(err) });
        }
        return;
      }

      case 'api-message': {
        try {
          const res = await fetch(`${API_URL}/debug-sentry/message`, { cache: 'no-store' });
          const body = (await res.json()) as {
            configured?: boolean;
            eventId?: string | null;
          };
          set(id, {
            status: body.configured && body.eventId ? 'ok' : 'failed',
            detail: body.configured
              ? `Reported · event ${body.eventId}`
              : 'API has no SENTRY_DSN configured',
          });
        } catch (err) {
          set(id, { status: 'failed', detail: describe(err) });
        }
        return;
      }
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Sentry test page</h1>
        <p className="text-sm text-muted-foreground">
          Each button triggers a real error on one layer of the stack. Open your Sentry
          issues feed alongside this page — an event should appear within a few seconds.
        </p>
        <div className="flex flex-wrap gap-2 pt-1 text-xs">
          <Chip
            ok={clientReady}
            label={clientReady ? 'Browser SDK initialised' : 'Browser SDK not initialised'}
          />
          <Chip ok label={`API ${API_URL}`} muted />
        </div>
        {!clientReady ? (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            No client SDK. Either NEXT_PUBLIC_SENTRY_DSN was missing when this bundle was
            built, or a browser extension blocked the SDK. The server-side tests below
            still work.
          </p>
        ) : null}
      </header>

      <div className="mt-10 space-y-8">
        {GROUPS.map((group) => (
          <section key={group.title} className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-medium">{group.title}</h2>
              <span className="font-mono text-xs text-muted-foreground">{group.layer}</span>
            </div>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {group.tests.map((test) => {
                const result = results[test.id];
                return (
                  <li key={test.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium">{test.name}</p>
                      <p className="text-xs text-muted-foreground">{test.description}</p>
                      {result?.detail ? (
                        <p
                          className={`break-words pt-1 font-mono text-xs ${
                            result.status === 'failed' ? 'text-destructive' : 'text-foreground/70'
                          }`}
                        >
                          {result.detail}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      variant={test.danger ? 'destructive' : 'outline'}
                      size="sm"
                      disabled={result?.status === 'running'}
                      onClick={() => void run(test.id)}
                      className="shrink-0 sm:w-32"
                    >
                      {result?.status === 'running' ? 'Running…' : 'Trigger'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

function Chip({ ok, label, muted }: { ok: boolean; label: string; muted?: boolean }) {
  const tone = muted
    ? 'border-border text-muted-foreground'
    : ok
      ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
      : 'border-destructive/40 text-destructive';
  return (
    <span className={`rounded-full border px-2.5 py-1 font-mono ${tone}`}>{label}</span>
  );
}

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `Request failed: ${message} (CORS or the service is down)`;
}
