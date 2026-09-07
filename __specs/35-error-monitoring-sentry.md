# 35 — Error Monitoring (Sentry)

## Goal

Every unhandled error in production reaches a single place, attributed to the
right layer, with enough context to act on — without shipping user data to a
third party and without making Sentry a hard dependency of the build or of
startup.

## Scope

Two Sentry projects under the `mllabs-xk` org:

| Project | Covers | SDK |
|---------|--------|-----|
| `addisaipro-backend` | `apps/api` (Express, Socket.io, jobs) | `@sentry/node` |
| `addisaipro-frontend` | `apps/web` — browser **and** Next.js server runtime | `@sentry/nextjs` |

`apps/admin`, `apps/widget` and `apps/embed` are **not** instrumented. The widget
runs on arbitrary customer sites, where third-party script noise would swamp the
project; admin is low-traffic and internal. Revisit per-app DSNs if that changes.

## Design decisions

1. **Errors only — no tracing, no session replay.** `tracesSampleRate: 0`
   everywhere. Performance data is not the problem being solved, tracing on a
   chat backend is expensive at volume, and Replay would record operator inboxes
   containing customer PII. Raising the sample rate is a one-line change per
   config if that changes.
2. **No PII.** `sendDefaultPii: false` on all four SDK inits. The API carries
   JWTs, contact emails and conversation content; none of it belongs in an event.
3. **Optional everywhere.** No DSN → the SDK is never initialised and every
   `Sentry.*` call is a no-op. A missing var must never fail a build, a boot or a
   request. This keeps local dev and self-hosted deploys unchanged.
4. **Init before anything else.** The Node SDK instruments modules as they are
   required, so `apps/api/src/instrument.ts` is the first import in `index.ts`.
   Any import placed above it loses instrumentation silently.
5. **4xx is not an error.** The Express handler reports only non-`ApiError`
   throws and `ApiError`s with status ≥ 500. Validation failures, 401s and 404s
   are expected outcomes, not incidents.
6. **Event IDs are returned to callers.** The API's 500 envelope carries
   `error.eventId` (from `res.sentry`), so a user-reported failure maps to one
   Sentry issue without log spelunking. Gated on `Sentry.isInitialized()`, not on
   `process.env.SENTRY_DSN`: an uninitialised SDK still hands back a generated id
   for an event it never sends, and returning that would send people hunting for
   an issue that does not exist.
7. **Browser events are tunnelled.** `tunnelRoute: '/monitoring'` proxies client
   events through the app's own origin, because ad blockers block
   `*.ingest.sentry.io` outright and would silently drop a share of real errors.

## File map

| File | Role |
|------|------|
| `apps/api/src/instrument.ts` | `Sentry.init()` for the API. First import in `index.ts`. |
| `apps/api/src/index.ts` | `setupExpressErrorHandler()` after all controllers, before `errorHandler`. |
| `apps/api/src/routes/debug.routes.ts` | `/debug-sentry` (throws) and `/debug-sentry/message` (handled). Rate limited 5/min/IP. |
| `apps/api/src/middleware/error-handler.middleware.ts` | Returns `error.eventId` on 500s. |
| `apps/web/src/instrumentation-client.ts` | Browser `Sentry.init()` + `onRouterTransitionStart`. |
| `apps/web/sentry.server.config.ts` | Node-runtime init, imported by `register()`. |
| `apps/web/sentry.edge.config.ts` | Edge-runtime init, imported by `register()`. |
| `apps/web/src/instrumentation.ts` | Loads the two configs; exports `onRequestError`. |
| `apps/web/src/app/global-error.tsx` | Reports root-level React render crashes. |
| `apps/web/next.config.ts` | `withSentryConfig` — bundle injection + source maps. |
| `apps/web/src/app/sentry-example-page/` | Production smoke-test page (see below). |
| `apps/web/src/app/api/sentry-example-api/route.ts` | Throwing route handler for the Next server test. |

## Environment variables

See [13-env-variables.md](./13-env-variables.md) for the canonical table. All are
optional.

Runtime (API and Next.js server): `SENTRY_DSN`, `SENTRY_ENVIRONMENT`,
`SENTRY_RELEASE`.

Build time (web only, because `NEXT_PUBLIC_*` is inlined into the client bundle):
`NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, plus `SENTRY_ORG` /
`SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` for source-map upload. Setting the public
DSN only at runtime is the single most likely misconfiguration: the app boots,
server errors report, and the browser SDK is silently absent.

## Test page

`/sentry-example-page` on the web app — public, `noindex`, outside every route
group so it needs no auth, no nav and no data and stays reachable on a broken
deploy. One button per reporting path:

| Test | Path exercised |
|------|----------------|
| Handled exception | Browser SDK, with `flush()` confirming delivery in-page |
| Uncaught exception | `window.onerror` |
| Unhandled rejection | `unhandledrejection` |
| React render crash | `global-error.tsx` |
| Route handler 500 | Next.js Node runtime + `onRequestError` |
| API unhandled 500 | Express `setupExpressErrorHandler`, returns the event ID |
| API handled message | `Sentry.captureMessage` on the API, returns the event ID |

The handled-exception and API-message tests are the diagnostic ones: they report
delivery success in the page itself, so a blocked or misconfigured DSN is visible
without opening Sentry.

## Operational notes

- The API debug endpoints are public but rate limited to 5/min per IP. They
  expose no data — the throwing one only produces a 500.
- Without `SENTRY_AUTH_TOKEN` at build time, production stack traces are
  minified. Errors still report; frames are just compiled.
- `SENTRY_RELEASE` is set to the image SHA by the deploy compose files, so an
  issue points at an exact build.
