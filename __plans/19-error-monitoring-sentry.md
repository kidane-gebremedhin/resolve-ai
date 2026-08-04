# Phase 19 — Error Monitoring (Sentry) ✅ COMPLETE

> Spec: [`__specs/35-error-monitoring-sentry.md`](../__specs/35-error-monitoring-sentry.md). Independent of every other phase — it adds observability, it does not change behaviour.
>
> **Implemented**: `@csb/api` and `@csb/web` type-check and build clean. See `CHANGELOG_1.md`.

## Goal

Unhandled errors in `apps/api` and `apps/web` report to Sentry in every deployed
environment, and a single public page proves — from production, in under a
minute — that each reporting path still works.

## Prerequisites

- Sentry org `mllabs-xk` with two projects: `chataxispro-backend`,
  `chataxispro-frontend`.
- The DSNs available to the Coolify services (runtime for the API, **build arg**
  for the web image).

## Work breakdown (ordered)

### 19.1 — Backend (`apps/api`)

| # | Task | Files touched | Acceptance |
|---|------|---------------|------------|
| 1 | Add `@sentry/node` | `apps/api/package.json` | `pnpm --filter @csb/api type-check` passes |
| 2 | `Sentry.init()` in a standalone module, no-op without a DSN | `src/instrument.ts` | Boots with `SENTRY_DSN` unset, logs one warning |
| 3 | Import it on line 1 of the entry point | `src/index.ts` | Nothing is imported above it |
| 4 | `setupExpressErrorHandler()` after controllers, before `errorHandler`, skipping `ApiError` < 500 | `src/index.ts` | A 404 produces no Sentry event; a thrown error does |
| 5 | Return `res.sentry` as `error.eventId` on 500s | `src/middleware/error-handler.middleware.ts` | 500 body contains the event id when a DSN is set |
| 6 | `/debug-sentry` + `/debug-sentry/message`, 5/min/IP | `src/routes/debug.routes.ts`, `src/routes/index.ts` | Mounted at the `/api/v1` root; 6th call in a minute → 429 |

### 19.2 — Frontend (`apps/web`)

| # | Task | Files touched | Acceptance |
|---|------|---------------|------------|
| 1 | Add `@sentry/nextjs` | `apps/web/package.json` | `next build` succeeds |
| 2 | Browser init + `onRouterTransitionStart` | `src/instrumentation-client.ts` | `Sentry.getClient()` is defined in the browser |
| 3 | Node + Edge init, loaded from `register()` | `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation.ts` | Dynamic imports keep the runtimes' bundles separate |
| 4 | `onRequestError` hook | `src/instrumentation.ts` | Route-handler throws reach Sentry |
| 5 | Root error boundary that reports | `src/app/global-error.tsx` | Render crash produces an event |
| 6 | `withSentryConfig` — bundle injection, `/monitoring` tunnel, source maps when a token exists | `next.config.ts` | Build passes with and without `SENTRY_AUTH_TOKEN` |

### 19.3 — Test page

| # | Task | Files touched | Acceptance |
|---|------|---------------|------------|
| 1 | `/sentry-example-page` with one button per reporting path | `src/app/sentry-example-page/{page,sentry-test-panel}.tsx` | 7 tests, `noindex`, no auth required |
| 2 | Throwing Next route handler | `src/app/api/sentry-example-api/route.ts` | Returns 500 |

### 19.4 — Deployment wiring

| # | Task | Files touched | Acceptance |
|---|------|---------------|------------|
| 1 | Sentry build args (DSN + source-map token) | `apps/web/Dockerfile`, `docker-compose.full.yml`, `.github/workflows/release-images.yml` | Build succeeds with every Sentry arg empty |
| 2 | `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` per environment | `coolify/docker-compose.{dev,staging,production}.yml` | Events are tagged with env + image SHA |
| 3 | Document every var | `.env.example`, `__specs/13-env-variables.md`, `RUNBOOK.md` §15 | Vars listed as optional |

## Non-goals

- Performance tracing, profiling and session replay (see spec 35, decision 1).
- Instrumenting `apps/admin`, `apps/widget`, `apps/embed`.
- Alert rules / Slack routing — configured in the Sentry UI, not in code.
