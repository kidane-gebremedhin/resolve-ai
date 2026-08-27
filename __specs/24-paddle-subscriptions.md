# 24 — Paddle.js Subscription System — Completion & Hardening

## Overview

> **Changelog 1 update — widget-driven subscription management.** The agentic
> Paddle tools (`get_subscription` / `upgrade_subscription` /
> `downgrade_subscription` / `cancel_subscription` in
> `services/integrations/providers/paddle.ts`) now let the widget AI manage a
> customer's plan conversationally. They take the customer **email** (optional —
> the dispatcher injects the verified ContactSession email) and a human **plan
> name** rather than raw Paddle IDs. On any API error the AI reports the failure
> honestly (no fabricated success). Requires the operator's Paddle **API key to have
> customer + subscription read/write permission**.
>
> **Per-operator integration Paddle (Changelog 8).** These tools act on the
> **operator's own Paddle** (their end-customers' subscriptions on the embedding
> website) — NOT this platform's billing Paddle. So: the plan⇄price mapping is the
> **operator's own**, stored per-connection (`credentials.extra.planPrices`, per env —
> sandbox and live differ) and configured via the card's "Configure plans" +
> `PUT /integrations/:connectionId/paddle-plans`; it no longer reads the platform's
> `PADDLE_PRICE_*` env (those are for platform billing, which is unchanged). The
> subscription is resolved by the **customer's email**; the platform `organizationId`
> is NOT injected (that tag only exists in the platform's own Paddle). The
> `upgrade/downgrade` `targetPlan` enum is set to the operator's configured plan names.
>
> **Env-slot consistency + downgrade fix (Changelog 5).** `planPrices` are read and
> written from the connection's **active environment** credential slot — not the
> `encryptedCredentials` mirror. The prior mirror-based read meant plans configured
> in sandbox vanished once the connection was switched to production (whose slot had
> no map), so BOTH upgrade and downgrade failed with "no plans configured" even though
> the UI (also reading the mirror) still showed the plans — the exact "configuration
> issue" operators hit. The adapter's error now names the environment to fix. The
> redundant **"Upgrades only / block-downgrades"** guardrail was **removed** — the AI
> performs downgrades as a normal self-service action, gated by `requireBillingOwner`.
> To stop operators from *skipping* the mapping in the first place, the "Configure plans"
> step is now folded into the connect flow: after connecting Paddle it opens automatically,
> **pre-filled from the operator's own Paddle catalog** (`GET /:connectionId/paddle-catalog`
> lists their prices/products and suggests the plan→price-id mapping), and an unconfigured
> connection shows a persistent "⚠ Configure plans" warning until it's done.
>
> **Stripe parity + connect-time price auto-fetch (2026-07 batch).** Everything above applies
> equally to **Stripe** — the same subscription tools, the same `paddle-catalog` endpoint
> (it serves both providers), and the same "Configure plans" UI. On top of the panel's
> pre-fill, connecting **either** provider with an API key now **auto-fetches the catalog and
> pre-fills `planPrices` at connect time** (`autoPopulateBillingPlans` in
> `integrations.routes.ts`, using the shared `fetchBillingCatalog` + `applyBillingPlanPrices`
> helpers), so the subscription tools work immediately without a manual step. Best-effort:
> it never throws (a restricted key without price-read permission just logs and the operator
> configures manually) and never clobbers an already-configured environment. Stripe fixes in
> the same batch: `current_period_end` is read from the subscription **item** (Stripe API
> 2025-03-31+ moved it there) with a legacy fallback, and `issue_refund` / `lookup_order`
> throw on a Stripe error instead of returning the raw error body as if it were a result.
>
> **Operator subscription webhook receiver (Changelog 5).** Operators can register a
> per-connection callback URL (`POST /integrations/paddle/webhook/:connectionId`, and
> the Stripe equivalent) in their OWN provider dashboard. Events are HMAC-verified
> against a per-connection signing secret (`credentials.extra.webhookSecret`, set via
> `PUT /integrations/:connectionId/webhook-secret`) and distilled into an
> `ExternalSubscription` snapshot so the assistant reflects out-of-band plan changes
> and can still answer "what plan am I on?" during a provider API outage. This is
> separate from the platform's own `POST /billing/webhook`.

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

### Scheduled-cancellation warnings (2026-07 batch)
When a platform subscription is set to cancel at period end, Paddle keeps it `active` and reports
a `scheduled_change` with action `cancel` — the plan stays usable until the effective date.
`Subscription.cancelScheduledAt` (optional Date) captures that effective date:
`handlePaddleEvent` sets it from `data.scheduled_change` and clears it (null) when there's no
scheduled change, so it stays correct through checkout activation and the admin "Refresh status"
reconcile (both route through `handlePaddleEvent`). `GET /billing/subscription` returns it.
Two dashboard surfaces warn about it while the plan is still active:
- **Billing page** ([`billing/page.tsx`](../apps/web/src/app/(dashboard)/app/billing/page.tsx)) —
  an amber banner at the top ("scheduled to cancel … access until <date>").
- **Header plan indicator** ([`app-shell.tsx`](../apps/web/src/components/layouts/app-shell.tsx)) —
  a warning triangle + amber pill on the "<Plan> · Change plan" chip; the dashboard layout passes
  `cancellationPending` down.

### Customer lookup + canceled reporting (2026-07 batch)
Subscription lookups resolve the customer by **email** (the identifier):
- **Archived customers are included.** Paddle's `GET /customers?email=` defaults to active-only;
  a reused customer can be archived yet still hold the live subscription, so the adapter queries
  `status=active&status=archived` and prefers an active match. (Paddle stores the email at
  checkout even though the overlay collects no name — see the name backfill below.)
- **Customer name backfill.** The overlay checkout creates the customer with just an email (Paddle
  shows "-" for the name). `handlePaddleEvent` backfills the name from the org **owner**
  (`backfillPaddleCustomerName`) when empty — best-effort, idempotent, runs on the reconcile too.
- **Only active/trialing count as "having a subscription."** `resolveSubscription` queries
  `status=active&status=trialing` only; a canceled/paused subscription is treated as **none**, so
  `get_subscription` returns the plain not-found message (`{ found: false, hasSubscription: false,
  message: "No subscription is associated with this email address…" }`) — never a "your plan was
  canceled" report. (An earlier iteration that surfaced canceled subs with an `includeInactive`
  option + a 3-tier chain in `agent.service` was reverted per product decision; the chain is back
  to the simple soft-miss walk.)

### `get_subscription` resolves ONLY from connected integrations (2026-07 batch)
The widget's `get_subscription` (and the other subscription tools) resolve a customer's
subscription **exclusively** from the operator's connected billing integrations (Stripe, Paddle,
…) via their live API — they must **never** read platform DB records (the `Subscription`
collection). In the dogfood setup the platform subscription lives in the connected Paddle account,
so it is found through that Paddle integration's live lookup, not from the local DB. (A DB-backed
platform-subscription fallback was considered and deliberately rejected to keep the integration the
single source of truth.) The only DB read on this path is the resilience cache
(`ExternalSubscription` snapshot) the dispatcher serves when the provider's live API is unreachable
— i.e. cached integration data, still keyed to the connection.

### Subscription receipt emails (2026-07 batch)
A branded receipt is emailed on every subscription **creation, upgrade, downgrade, or
cancellation** — renewals and payment-method updates send nothing. Shared logic lives in
`services/subscription-receipt.service.ts` (`classifyReceiptAction`,
`buildSubscriptionReceiptEmail`, `sendSubscriptionReceipt`); full receipt = action heading,
plan, amount + interval, next-renewal/access-until date, and a "Manage billing" button.
All sends are fire-and-forget (they never block webhook processing) and no-op if SMTP is
unconfigured.

Two audiences:
- **Platform subscription** (the operator's own SaaS plan) → the org's **owner/admin** emails.
  `billing.service.ts:handlePaddleEvent` snapshots the prior plan/status, classifies the
  change (direction by plan tier: pro < business < enterprise; amount from the plan catalog),
  and sends. Because checkout activation and the admin "Refresh status" both flow through
  `handlePaddleEvent` (via `syncSubscriptionFromPaddle`), creation is covered too; the later
  real webhook sees the already-updated plan and no-ops (natural de-dup).
- **Operator's customers' subscriptions** → the **customer**, under the operator's brand
  (org name as the From name). `integrations/webhookReceiver.ts` resolves the price
  amount+currency (Stripe reads the embedded `unit_amount`; Paddle fetches `GET /prices/{id}`),
  stores them on `ExternalSubscription`, classifies, and sends. Scheduled cancels (Paddle
  `scheduled_change:cancel`, Stripe `cancel_at_period_end`) count as a cancellation so the
  customer is notified at cancel time, not only at period end; the definitive later event is
  de-duped via `canceledAt`.

**Correct up/down label for widget-driven changes:** the dispatcher eagerly overwrites the
snapshot's plan the moment a widget tool runs, which would erase the "prior" the webhook uses
to infer direction. The dispatcher therefore stamps `ExternalSubscription.pendingReceipt =
{ action, at }` (action known from the tool key); the webhook prefers that hint when recent
(< 15 min) and clears it (which also de-dups). Out-of-band dashboard changes have no hint and
fall back to amount-based inference. Customer receipts require the operator to have configured
the inbound webhook callback (same as the existing snapshot sync). New optional
`ExternalSubscription` fields: `amount`, `currency`, `pendingReceipt` (no migration needed).

### Plan changes preserve the billing cycle (Changelog 15)
`upgrade_subscription` / `downgrade_subscription` change the plan **tier only** and
keep the customer's current billing interval — a yearly subscriber upgrading stays
yearly, never silently flips to monthly. Implementation: `resolveSubscription` reads
the live item's `price.billing_cycle.interval` (with an env yearly-id fallback) and
its seat `quantity`; the change picks `priceForPlan(targetPlan, currentInterval)` and
PATCHes with the preserved quantity. If the target plan has no price at that interval
the tool fails clearly instead of switching cadence. The result includes
`billingInterval` so the AI confirms it ("now on Business, billed yearly"). The local
mirror (`syncSubscriptionFromPaddle`) already derives plan + interval from the price
id, so the dashboard reflects the same.

### Not-found must be explicit (anti-hallucination)
`get_subscription` for an email that matches no customer/active subscription returns
a **structured** `{ found: false, hasSubscription: false, message }` — it does NOT
throw. A thrown error collapses into the same generic `{ error }` shape as a
transient failure, and the model (told to hide errors and that the tools always
work) would fill the gap by inventing a plan ("you're on Enterprise"). The Paddle
prompt (`prompts.ts`) states that a not-found is a definite answer — say plainly no
subscription is on file and **never guess a plan**. Mutations
(`upgrade`/`downgrade`/`cancel`) still throw on no-subscription; only the read tool
degrades gracefully. Note: the visitor's email is `ContactSession.email` (whatever
they typed) — it is NOT ownership-verified, so a not-found is the correct, honest
response for a non-account-holder email.

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

### Payment ledger and dunning (Changelog 8)

Until this batch, `handlePaddleEvent` returned early on anything that did not
start with `subscription.`, so every `transaction.*` event was silently dropped.
The app knew what a customer was entitled to and nothing about what they had
actually been charged, which is why the checkout pending page could only spin
for three minutes on a declined card: the subscription poll cannot tell "still
processing" from "the payment failed".

**Signature verification reads `req.rawBody`, never a second body parser.** The
global `express.json({ verify })` in `index.ts` is the only body reader, and it
stashes the exact signed bytes on `req.rawBody`. Mounting `express.raw()` on the
webhook route does not work and never did: body-parser sees `req._body` already
set and skips, so `req.body` stays the parsed object and the HMAC ends up
computed over an empty string, rejecting every real delivery with 401. The
per-connection integration webhooks in `integrations.routes.ts` have always read
`rawBody`; platform billing now does too. `src/test/app.ts` carries the same
`verify` callback so the test harness cannot drift from production here again.

**Dispatch.** `handlePaddleEvent` is now a dispatcher over three event families,
and **the `ProcessedWebhook` idempotency guard runs first, before the family is
inspected**. Its previous position — immediately after the `subscription.` early
return — meant transaction events never reached it at all, and moving the
dispatch above it would have let a redelivered transaction book a second payment
row. Paddle does redeliver.

Because the guard is claimed before any handler runs, a handler that throws
loses the event permanently: Paddle's retry arrives and is swallowed as a
duplicate. Every handler therefore writes idempotently (upsert by provider id)
and pushes anything fallible, email above all, onto a fire-and-forget path.

**Event names, verified against Paddle Billing's webhook reference.** Two things
here contradict a reasonable guess and are worth stating so they are not
"corrected" back:

1. There is **no** `transaction.refunded`, `transaction.partially_refunded` or
   `transaction.disputed`. Refunds and chargebacks arrive as `adjustment.created`
   / `adjustment.updated`, carrying `action` (`refund` | `chargeback` |
   `chargeback_reverse` | `chargeback_warning` | `credit` | `credit_reverse`),
   `type` (`full` | `partial`), and a `transaction_id` pointing back at the
   transaction they adjust. An adjustment is only applied when its own `status`
   is `approved`; a `pending_approval` refund has moved no money.
2. Money is at `data.details.totals.*` as **strings in minor units**, not as
   numbers at the top level. The parser returns `undefined` rather than `0` for
   anything unreadable, because a silent zero in a billing history is
   indistinguishable from a free month.

Transaction states map as: `paid` / `completed` → `completed`, `billed` →
`pending`, `past_due` → `failed`, and `transaction.payment_failed` → `failed`
regardless of state. `draft`, `ready` and `canceled` map to **nothing** and leave
no row: a draft transaction is a quote, and a canceled one never took money.

**Out-of-order delivery.** Last-write-wins is wrong here — a replayed
`transaction.updated` would drag a paid invoice back to `pending` in the
customer's history. The event's own `occurred_at` is authoritative; a
terminality rank breaks ties only when timestamps match or are absent. `failed`
ranks *below* `completed` deliberately: a retried card that finally clears keeps
the same transaction id, so `failed → completed` must remain a legal forward
move. A stale event is not discarded outright — it may still fill in fields we
are missing, since Paddle sometimes populates the invoice id or card details
only on the later-numbered event.

**Dunning.** A failed payment sets `Subscription.status = past_due` and emails
the org's owners and admins (`payment_failed`, a new `ReceiptAction`). A later
`completed` for the same org clears it. This path writes `Subscription.status`
**only**; `Organization.plan` stays under the subscription handler's control, so
access is not revoked while the provider is still retrying the card. A canceled
subscription is never dunned.

**Organization resolution.** Renewals do not echo the checkout's `custom_data`,
so resolution falls back from `custom_data.organizationId` → the subscription
behind `data.subscription_id` → an existing payment row for the same
transaction. Reading only `custom_data` silently drops every renewal.

**Invoices are minted, not stored.** Paddle sends no receipt or invoice URL on
the webhook, and the link `GET /transactions/{id}/invoice` returns **expires
after an hour**. Caching it would guarantee a dead link by the time anyone
clicked, so `GET /billing/payments/:id/invoice` mints a fresh one per click,
scoped to the caller's org. The list response carries `hasInvoice` so the UI
does not offer a link for a charge that never billed, which would 404.

**Backfill.** `pnpm --filter @csb/api billing:backfill-payments` pages Paddle's
`/transactions` per subscription and replays each one through
`applyTransactionEvent`, so backfilled rows are identical to live ones and a
later webhook for the same transaction still wins on timestamp. `--dry-run`
counts without writing, `--org` and `--after` narrow the scan, and 429s back off
on Paddle's `retry-after`. Safe to re-run; an interrupted run is simply started
again.

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

### Checkout entry flow (plan-through-signup)
The conversion path is **pricing → signup → checkout**, and the plan the visitor chose must survive the round-trip:
- Public **"Get Started"** CTAs (navbar/hero/CTA) link to **`/pricing`**, not `/register` — visitors choose a plan first.
- Each pricing plan card links to `/register?plan=<tier>` (tier = `starter|pro|enterprise`, mapped from the template id via `TIER_BY_ID`).
- The signup form (`SignupHero`) carries `?plan=` through (alongside `?ref=`/`?campaign=`) and, after the account is created + auto-login, redirects to `/checkout?plan=<tier>`.
- `/checkout` reads `?plan=` and the logged-in email from the session, and `CheckoutPlans` **opens that plan's Paddle overlay directly** (email pre-filled via `Checkout.open({ customer: { email } })`). When a plan is preselected it **hides the plan grid entirely** and shows a focused "opening checkout" panel (with a "Choose a different plan" link) — the user does not see the plans page again.
- When **no** plan is preselected (e.g. the user logged in directly without choosing on `/pricing`) _(Changelog 19)_: `CheckoutPlans` renders the **full plans grid in-place** (cards with name, price, features; CTA opens the Paddle overlay via the same `subscribe()` path). Previously this case bounced to `/pricing`; now the user can subscribe without leaving checkout. A "Compare plans in detail" link still points to `/pricing`.

### Click-to-highlight plan cards _(Changelog 28)_
Clicking a plan card visibly selects it (rings the chosen card, clears the others) on **every** plan surface: the public pricing grid (`Pricing.tsx`), the in-checkout grid (`CheckoutPlans`), and the dashboard billing plans grid (`billing/page.tsx`). Implemented once as a small client island `PlanHighlighter` (`apps/web/src/components/billing/plan-highlighter.tsx`) that wraps the grid and uses event delegation: each card carries a `data-plan-card` attribute, and the wrapper toggles `ring-2 ring-primary ring-offset-2 ring-offset-background` on the clicked card. Delegation lets it work with both server-rendered cards (pricing, billing) and client ones (checkout) without per-card state. This is purely a selection affordance — it does not itself start checkout (the card's own CTA does that).

**Single selection (Changelog 28):** the selection ring is the *only* ring on a card, so exactly one card ever looks selected. The "recommended"/"current" cards keep a distinguishing **border** (and badge) but carry **no decorative ring** of their own — previously the pro card (`ring-1 ring-primary/30`) and the current-plan card (`ring-1 ring-foreground`) kept a ring that visually competed with the user's selection, so selecting a different plan looked like two were selected. Clicking a card clears the ring from every sibling before ringing the clicked one, so the previously selected plan is always deselected.

### Post-payment activation → dashboard redirect
After `checkout.completed`, the subscription becomes `active` one of two ways: the Paddle **webhook** (production) or a direct **`POST /billing/activate { transactionId }`** call (works on localhost, where the webhook can't reach the dev server). To avoid stranding a paid user on the checkout page when one path is slow/missing _(Changelog 27)_:
- The `transactionId` is read defensively from every known `checkout.completed` payload shape (`transaction_id` / `transactionId` / `id`, also nested under `data`).
- `startPolling(transactionId)` **re-attempts `/billing/activate` on every tick** (the first call in `onCompleted` can race ahead of Paddle marking the txn paid) **and** checks `/billing/subscription`. Either confirming → `finishAndEnter()` (clear the plan hint, `router.push("/app")` + `refresh()`).
- If neither confirms within the 180s window, the panel surfaces a manual **"Continue to dashboard"** button (instead of silently stopping) so the user is never dead-ended.
- All success paths funnel through the single `finishAndEnter()` helper so they behave identically.

### Stale-session gate (ghost users)
The `/app` dashboard is gated until a subscription is `active`, redirecting unpaid orgs to `/checkout`. After a **data wipe / account deletion**, the NextAuth cookie + API JWT are still cryptographically valid, so the old behavior bounced the now-nonexistent user to `/checkout` forever. Fixes:
- API `requireAuth` verifies the token's user **still exists** (`User.exists`) and returns **401** when it doesn't — so deleted accounts immediately lose access (security win too).
- The web server-side API client redirects 401s to a `/logout` Route Handler that calls NextAuth `signOut` to **clear the cookie** before `/login` (a bare redirect would leave the stale cookie and re-gate the ghost user).

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
