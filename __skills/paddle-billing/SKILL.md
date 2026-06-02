---
name: paddle-billing
description: Integrate Paddle Billing — checkout flow, webhook handler with signature verification + idempotency, subscription lifecycle handling, plan-limit enforcement, customer portal. Use during Phase 4 once all features that consume plan limits exist. Implements __specs/10-frontend-phases.md Phase 4 + __specs/16-production-readiness-audit.md §6.
---

# Paddle Billing Integration

## When to use

Phase 4, **last** before production readiness. All other phases must be done so plan-limit checks have features to gate.

## Prerequisites

- Paddle account (sandbox + production)
- Four products + prices created in Paddle dashboard: Free, Starter, Pro, Enterprise
- `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT`, `PADDLE_PRICE_STARTER`, `PADDLE_PRICE_PRO`, `PADDLE_PRICE_ENTERPRISE` in `.env`
- `Subscription` Mongoose model from [`express-mongoose-scaffold`](../express-mongoose-scaffold/) wired

## Procedure

1. **Install SDK** in `apps/api`: `@paddle/paddle-node-sdk` (server) and in `apps/web`: `@paddle/paddle-js` (client overlay).

2. **Service** — `apps/api/src/services/billing.service.ts`:
   - `createCheckout({ orgId, plan })` → uses Paddle SDK to generate a checkout link; returns URL for `apps/web` to redirect/open as overlay
   - `getSubscription(orgId)` → reads `Subscription` from Mongo; falls back to Paddle API if stale
   - `cancelSubscription(orgId)` → Paddle SDK cancel + update local row
   - `getCustomerPortalUrl(orgId)` → Paddle SDK portal session

3. **Webhook route** — `apps/api/src/routes/billing.routes.ts`:
   ```
   POST /billing/paddle/webhook
   ```
   - Verify `Paddle-Signature` header using `PADDLE_WEBHOOK_SECRET` (Paddle SDK has a helper). Reject 401 if invalid.
   - **Idempotency**: store processed `event.id` in Mongo (TTL 30 days). Duplicate → return 200 without re-processing.
   - Handle event types:
     - `subscription.created` → upsert `Subscription`, update `organizations.plan`
     - `subscription.updated` → update plan + status
     - `subscription.canceled` → status='canceled'; keep features until period end
     - `subscription.past_due` → status='past_due'; show banner in dashboard
     - `transaction.completed` → record payment (audit log)
   - Spec §16 §6.3, §6.6 lists every event type to handle.

4. **Plan limits** — `apps/api/src/middleware/plan-limit.middleware.ts`:
   | Plan | AI msg/month | KB sources | Firecrawl pages/month |
   |------|--------------|------------|------------------------|
   | Free | 100 | 20 | 50 |
   | Starter | 2,000 | 100 | 500 |
   | Pro | 10,000 | 500 | 5,000 |
   | Enterprise | Unlimited | Unlimited | Unlimited |

   Increment counters in Mongo on each successful action; check threshold before allowing.
   - AI message cap exceeded → auto-escalate to human (don't reject; degrade gracefully)
   - KB source cap exceeded → reject with 402 `code: 'PLAN_LIMIT'`
   - Firecrawl page cap exceeded → reject before calling Firecrawl

5. **Dashboard `/app/billing`** — wire the template page to:
   - `GET /billing/subscription` for current plan + usage meters
   - Plan tiles → on click → `POST /billing/checkout` → open Paddle.js overlay
   - "Manage subscription" → `POST /billing/portal` → redirect to portal URL

6. **Dashboard `/app/usage`** — wire usage meters to the same `/billing/subscription` payload (it includes the `usage` block). Spec §11 routes both pages.

7. **Webhook endpoint exposure** in dev — Paddle needs a public URL. Use `cloudflared tunnel --url http://localhost:4000` per spec §19 §8; configure the tunnel URL in Paddle webhook settings.

## Gotchas

- **`Paddle-Signature` verification is non-negotiable** — without it, anyone can POST a fake `subscription.canceled` and downgrade an org. Reject any webhook with missing/invalid signature.
- **Idempotency** — Paddle retries failing webhooks. Without dedup, you could process the same `subscription.created` twice and create duplicate rows. Index `processed_events.eventId` unique.
- **Paddle sandbox vs production** — `PADDLE_ENVIRONMENT=sandbox` uses different API endpoints. Mismatch silently fails.
- **`paddleCustomerId`** is stored on `organizations` (sparse unique index per spec §03). Look it up before creating a checkout — re-create only if missing.
- **Price IDs differ between sandbox + production** — separate env vars per environment in Coolify ([`coolify-three-env-deploy`](../coolify-three-env-deploy/) §4.1).
- **Soft cancellation** — when `subscription.canceled` arrives, the user keeps Pro features until `current_period_end`. Don't immediately revoke.
- **Free plan limits** are enforced even without a Paddle subscription — new orgs default to `plan: 'free'`. Spec §10 Phase 4.
- **Webhook signature header name** is case-sensitive in some libraries. Always use `req.headers['paddle-signature']` (Express normalizes to lower-case).

## Acceptance

- [ ] Checkout flow: dashboard → Paddle overlay → test card → success → webhook received → `Subscription` row created → `organizations.plan` updated (verify via `paddle-mcp` + `mongo-mcp`)
- [ ] Invalid webhook signature → 401, not processed
- [ ] Duplicate webhook (same eventId) → 200, single DB write
- [ ] All lifecycle events update DB correctly (created/updated/canceled/past_due/completed)
- [ ] Free plan: 101st AI message of the month auto-escalates instead of replying
- [ ] Starter plan: 21st KB source rejected with 402
- [ ] Upgrade Starter → Pro: limits increase immediately
- [ ] Cancel: plan stays active until period end, then reverts to Free
- [ ] Customer portal link opens working Paddle portal
- [ ] Spec §16 §6 audit checklist all green

## Specs referenced

- [`__specs/10-frontend-phases.md`](../../__specs/10-frontend-phases.md) Phase 4 — billing task list
- [`__specs/16-production-readiness-audit.md`](../../__specs/16-production-readiness-audit.md) §6 — Paddle audit (PaddleMCP-driven)
- [`__specs/03-data-model.md`](../../__specs/03-data-model.md) — `Subscription` + `Organization.plan` + `Organization.paddleCustomerId`
- [`__specs/07-api-specification.md`](../../__specs/07-api-specification.md) §"Billing" — routes
- [`__specs/13-env-variables.md`](../../__specs/13-env-variables.md) §"Paddle" — env vars
- [`__skills/__skills/mcp-builder/`](../mcp-builder/) (downloaded) — reference when adding any future MCP servers (e.g. internal billing-MCP)
