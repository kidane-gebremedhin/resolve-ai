# Changelog 5

## UI Polish, Checkout Flow, & Paddle Webhook Hardening

### Summary

1. **Monthly/Yearly toggle readability** — dark mode contrast restored on the homepage pricing section.
2. **Checkout flow corrected** — pre-selected plan shows a minimal "Starting checkout for X plan" transition screen and opens the Paddle overlay directly; no plan selected shows the full plans grid. When activation takes too long after payment, the user is redirected to a new `/checkout/pending` page instead of being stranded.
3. **Paddle webhook affiliate commission** — commission recording is now fire-and-forget so a transient failure cannot block the webhook 200 response.

---

### Changes

**`apps/web/src/components/ns/homepage-34/Pricing.tsx`**
- Active toggle button in dark mode: changed `dark:text-secondary` → `dark:text-[#1a1a1c]`.
  - Root cause: in the `ns-theme`, both `--color-secondary` and `--color-accent` resolve to `#fcfcfc` in dark mode, making button background and text the same color (white on white).
- Inactive toggle buttons: raised opacity from `/60` → `/80` for better readability in both modes.

**`apps/web/src/components/billing/checkout-plans.tsx`**
- Pre-selected plan (from URL `?plan=` or sessionStorage): shows a minimal "Starting checkout for {Plan} plan" + spinner; Paddle overlay opens automatically. "Choose a different plan" clears sessionStorage and the chosen tier in-place, revealing the full grid without a page navigation.
- No plan selected: full three-plan grid with billing interval toggle.
- Removed `activationStuck` state. When the 3-minute activation poll expires, redirects to `/checkout/pending` and clears sessionStorage — no longer strands the user on the checkout page.
- Added `router` to `startPolling` dependency array.

**`apps/web/src/app/(dashboard)/checkout/pending/page.tsx`** — new page
- "Pending Subscription Status" — reached after payment when subscription activation hasn't confirmed within the checkout polling window.
- Polls `GET /billing/subscription` every 4 seconds; auto-redirects to `/app` with a success screen on activation.
- Shows elapsed seconds, a "Continue to dashboard" escape hatch, and a support contact link.
- Inherits the `(dashboard)` group layout (authenticated), renders its own Logo header.

**`apps/api/src/services/billing.service.ts`**
- In `handlePaddleEvent`: `recordEarnedCommissionForOrg` is now fire-and-forget (`.then().catch(logger.warn)`) instead of `await`.
  - Before: a commission failure caused the webhook route to return 500, Paddle retried, but the idempotency guard blocked re-processing — silently dropping the commission forever.
  - After: webhook always returns 200 on success; commission failures are logged as warnings.
