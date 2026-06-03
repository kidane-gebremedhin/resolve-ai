# 24 — Paddle.js Subscription System — Completion & Hardening

## Overview

Backlog item #4: "subscription system should be powered by Paddle.js; define any credentials needed in env vars." **The integration largely exists** ([`07-api-specification.md`](./07-api-specification.md), [`__skills/paddle-billing`](../__skills/paddle-billing/)). This spec closes the gaps that block real checkout and production-readiness. Plan: [`__plans/08-paddle-subscriptions.md`](../__plans/08-paddle-subscriptions.md).

## Current state

| Capability | Status | Evidence |
|---|---|---|
| Server SDK `@paddle/paddle-node-sdk` | ✅ | `apps/api/package.json` |
| Client SDK `@paddle/paddle-js` | ✅ | `apps/web/package.json`; loader `apps/web/src/lib/paddle.ts` |
| Webhook + HMAC verify | ✅ | `apps/api/src/routes/billing.routes.ts` (`POST /billing/webhook`), `billing.service.ts:verifyPaddleSignature` |
| `subscription.*` → DB sync | ✅ | `billing.service.ts:handlePaddleEvent` upserts Subscription + Organization |
| Overlay checkout + portal | ✅ | `billing.service.ts:createCheckoutSession/createCustomerPortalSession`; `plan-actions.tsx` |
| Subscription/Organization models | ✅ | `Subscription.ts`, `Organization.ts` (paddleCustomerId/SubscriptionId, plan, status, periods) |
| Plan-limit enforcement | ⚠️ partial | `plan-limit.middleware.ts`: messages + KB enforced; **websites + team members not** |
| Billing UI / admin subscriptions | ✅ | `(dashboard)/app/billing`, `(admin)/admin/subscriptions` (manual "Refresh" is a **no-op**) |

## Gaps to close

| Gap | Detail |
|---|---|
| **G1 — Env credentials** | Placeholders block checkout: `PADDLE_WEBHOOK_SECRET=GENERATE_NEW`, `PADDLE_PRICE_*=CREATE_PRICING_PLAN`; `PADDLE_ENVIRONMENT=sandbox` but a **live** `PADDLE_API_KEY` is set (mismatch). Client vars **absent**: `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENV`, `NEXT_PUBLIC_PADDLE_PRICE_{STARTER,PRO,ENTERPRISE}`. |
| **G2 — Webhook idempotency** | No event-dedup; Paddle retries can double-apply. |
| **G3 — Centralized config** | Paddle vars read via raw `process.env` in `billing.service.ts`; not in `apps/api/src/config/env.ts` validation. |
| **G4 — Quota coverage** | No `enforceWebsiteQuota` / `enforceTeamMemberQuota`. |
| **G5 — Plan/price source of truth** | Billing + pricing pages hardcode plans/prices, divergent from each other and from Paddle. |
| **G6 — Manual sync no-op** | Admin "Refresh status" does nothing; no reconcile-from-Paddle path. |
| **G7 — shared-types drift** | `packages/shared-types` Subscription is missing `paused`, `paddleCustomerId`, `currentPeriodStart`, `canceledAt`, `trialEndAt`. |

---

## Design

### Credentials (G1) — the explicit ask
Define and document **all** Paddle credentials as env vars (add to [`.env.example`](../.env.example) + the live `apps/api/.env` / `apps/web/.env.local`, per repo env convention and [`13-env-variables.md`](./13-env-variables.md)):

Server (`apps/api`):
- `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT` (`sandbox|production` — must match the key), `PADDLE_PRICE_STARTER`, `PADDLE_PRICE_PRO`, `PADDLE_PRICE_ENTERPRISE`.

Client (`apps/web`, `NEXT_PUBLIC_` so they inline at build):
- `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENV`, `NEXT_PUBLIC_PADDLE_PRICE_STARTER`, `NEXT_PUBLIC_PADDLE_PRICE_PRO`, `NEXT_PUBLIC_PADDLE_PRICE_ENTERPRISE`.

Decisions:
- **Sandbox-first.** Set `PADDLE_ENVIRONMENT=sandbox` with a sandbox key + sandbox client token + sandbox price IDs; resolve the live/sandbox mismatch by using sandbox everywhere until go-live. Production creds are swapped at deploy time (distinct per environment — never reuse).
- Add a startup assertion: if `PADDLE_ENVIRONMENT=production` while key looks like sandbox (or vice versa), log a loud warning.
- Provision the sandbox products/prices via the Paddle MCP (`mcp__paddle__create_product` / `create_price`) and the client-side token via `mcp__paddle__create_client_side_token`; record the IDs in env. (Use the [[__skills/paddle-billing]] procedure.)

### Idempotency (G2)
- Add a `ProcessedWebhook` collection (`eventId` unique) or store last-processed `eventId` per subscription; `handlePaddleEvent` no-ops if seen. TTL-index old rows (e.g., 30d).

### Centralized config (G3)
- Move Paddle vars into [`apps/api/src/config/env.ts`](../apps/api/src/config/env.ts) with validation; `billing.service.ts` reads from `env`.

### Quotas (G4)
- Add `enforceWebsiteQuota` + `enforceTeamMemberQuota` mirroring the existing pattern; wire to website-create and member-invite routes. Limits already exist in `PLAN_LIMITS`.

### Single plan catalog (G5)
- One server-owned catalog module (`apps/api/src/config/plans.ts`) mapping `plan → { priceId, displayPrice, features, limits }`, exposed via `GET /billing/plans`. Billing + pricing pages consume it instead of hardcoding. Keeps `PLAN_LIMITS`, prices, and price IDs in sync from one place.

### Reconcile / manual sync (G6)
- `POST /admin/subscriptions/:id/sync` (admin) and/or `POST /billing/sync` (org): fetch the subscription from Paddle (`get_subscription`) and re-run the upsert. Replaces the no-op button.

### shared-types (G7)
- Update `packages/shared-types` Subscription to match the Mongoose model (add `paused`, `paddleCustomerId`, `currentPeriodStart`, `canceledAt`, `trialEndAt`).

---

## Out of scope
- Usage-based / metered billing, proration previews UI, multi-currency display, dunning emails (covered once the mailer from [`25-affiliate-system.md`](./25-affiliate-system.md) lands), tax/VAT config UI.

## Acceptance
- [ ] All Paddle env vars documented in `.env.example`; sandbox values populated; env/key consistency assertion in place.
- [ ] A sandbox checkout completes end-to-end: overlay → `subscription.created` webhook → `Subscription` + `Organization.plan` updated (`mongo-mcp`), verified with `paddle-mcp`.
- [ ] Re-delivering the same webhook event does not double-apply (idempotency).
- [ ] Website + team-member quotas enforced (402 at limit).
- [ ] Billing + pricing pages render from `GET /billing/plans` (no hardcoded prices).
- [ ] Admin "Refresh status" reconciles from Paddle.
- [ ] `pnpm build` + `type-check` + `test` green.
