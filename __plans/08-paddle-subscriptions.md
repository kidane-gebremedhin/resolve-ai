# Phase 7 — Paddle.js Subscriptions: Completion & Hardening

> Spec: [`__specs/24-paddle-subscriptions.md`](../__specs/24-paddle-subscriptions.md). Backlog #4. **Gap-fill** over an existing Paddle integration.

## Goal

Make the existing Paddle.js billing actually runnable and production-safe: define all credentials as env vars, provision sandbox products/prices/token, add webhook idempotency, centralize config + a single plan catalog, finish quota enforcement, and replace the no-op admin sync with a real reconcile — so a sandbox checkout flows overlay → webhook → DB → enforced limits.

## Prerequisites

- Existing billing service, webhook, models, and UI (already shipped).
- `paddle-mcp` connected (provisioning + verification).
- A Paddle **sandbox** account.

## Skills to invoke

- [[__skills/paddle-billing]] — products/prices/token provisioning + webhook setup procedure.
- [[__skills/express-mongoose-scaffold]] — idempotency model, quota middleware, plan catalog, sync route.

## Work breakdown (ordered)

| # | Task | Files | Skill | Acceptance |
|---|------|-------|-------|------------|
| 1 | Provision sandbox products + prices + client-side token via `paddle-mcp`; record IDs | (Paddle MCP; env files) | paddle-billing | Price IDs + client token exist in sandbox |
| 2 | Add **all** Paddle env vars (server + `NEXT_PUBLIC_*` client) to `.env.example`, `apps/api/.env`, `apps/web/.env.local`; set sandbox values; fix env/key mismatch (sandbox everywhere) | `.env.example`, `apps/api/.env`, `apps/web/.env.local` | — | `verify:env` passes; `isPaddleConfigured()` true |
| 3 | Centralize Paddle config in `env.ts` with validation + a startup env/key-consistency assertion | `apps/api/src/config/env.ts`, `apps/api/src/services/billing.service.ts` | express-mongoose-scaffold | Service reads from `env`; mismatched env logs a loud warning |
| 4 | Webhook idempotency: `ProcessedWebhook` model (`eventId` unique, TTL); `handlePaddleEvent` no-ops on seen events | `apps/api/src/models/ProcessedWebhook.ts` (new), `apps/api/src/services/billing.service.ts` | express-mongoose-scaffold | Re-delivering an event does not double-apply (`mongo-mcp`) |
| 5 | Single plan catalog `config/plans.ts` (`plan → priceId, price, features, limits`); `GET /billing/plans`; reconcile with `PLAN_LIMITS` | `apps/api/src/config/plans.ts` (new), `apps/api/src/middleware/plan-limit.middleware.ts`, `apps/api/src/routes/billing.routes.ts` | express-mongoose-scaffold | One source of truth; endpoint returns catalog |
| 6 | Billing + pricing pages consume `GET /billing/plans` (remove hardcoded prices) | `apps/web/src/app/(dashboard)/app/billing/page.tsx`, `apps/web/src/components/ns/homepage-34/Pricing.tsx`, `apps/web/src/components/billing/plan-actions.tsx` | — | No hardcoded prices; cards render from catalog |
| 7 | Add `enforceWebsiteQuota` + `enforceTeamMemberQuota`; wire to website-create + member-invite routes | `apps/api/src/middleware/plan-limit.middleware.ts`, website/member routes | express-mongoose-scaffold | 402 at limit; below limit passes |
| 8 | Real admin reconcile: `POST /admin/subscriptions/:id/sync` (and/or `POST /billing/sync`) fetches from Paddle + re-upserts; wire the admin button | `apps/api/src/routes/admin.routes.ts`, `apps/web/src/app/(admin)/admin/subscriptions/page.tsx` | paddle-billing | Button reconciles status from Paddle |
| 9 | Update `packages/shared-types` Subscription to match the model | `packages/shared-types/src/models.ts` | — | `type-check` green; no drift |
| 10 | Update spec 24 + this plan with deltas; append `CHANGELOGS_*.md` | docs | — | Docs match shipped behavior |

## Decisions baked in (from spec)
- Sandbox-first; production creds swapped at deploy (distinct per env).
- One server-owned plan catalog feeds limits, prices, and price IDs.
- Webhook is source of truth; manual sync is a reconcile, not a parallel write path.

## Verification
- [ ] Sandbox checkout: overlay → `subscription.created` → `Subscription` + `Organization.plan` updated (`mongo-mcp` + `paddle-mcp`).
- [ ] Duplicate webhook delivery is idempotent.
- [ ] Website + team quotas return 402 at limit.
- [ ] Billing + pricing render from `/billing/plans`; admin Refresh reconciles.
- [ ] `pnpm build` + `type-check` + `test` green.

## Out of scope (defer)
- Metered billing, proration preview UI, multi-currency, dunning emails (needs mailer from Phase 8), tax/VAT UI.
