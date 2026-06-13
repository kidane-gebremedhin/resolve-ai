# Changelog 2

## Subscription Plans Overhaul

### New Plan Structure

| Internal key | Display name | Monthly | Yearly |
|---|---|---|---|
| `starter` | Pro | $70/mo | $588/yr |
| `pro` | Business | $199/mo | $1,671.60/yr |
| `enterprise` | Enterprise | $399/mo | $3,351.60/yr |

### Paddle Product / Price IDs

| Plan | Monthly Price ID | Yearly Price ID |
|---|---|---|
| Pro (starter) | `pri_01kv040gfh2zn8c8w5dbxks0ar` | `pri_01kv040gz0aj88msykn53h6aj8` |
| Business (pro) | `pri_01kv04134mxd1xze240m5r6dxj` | `pri_01kv0413nfnfkpjbx1nqwvr062` |
| Enterprise | `pri_01kv041p7n19psrt1n2vk1van1` | `pri_01kv041pkett2xv7mtptcmhm2v` |

---

### Backend

**`apps/api/src/config/plans.ts`**
- Display names updated: Basic→Pro, Business stays Business, Enterprise stays Enterprise
- Prices updated: $19→$70, $99→$199, $199→$399
- Added `priceIdYearly` and `priceYearlyUsd` fields to `PlanCatalogEntry`
- Added new env vars: `PADDLE_PRICE_STARTER_YEARLY`, `PADDLE_PRICE_PRO_YEARLY`, `PADDLE_PRICE_ENTERPRISE_YEARLY`
- `planByPriceId()` now maps both monthly and yearly price IDs → plan tier
- Admin override type (`PlanOverride`) extended with `priceIdYearly` / `priceYearlyUsd`
- Added `PLAN_DISPLAY_NAMES` export for consistent label rendering

**`apps/api/src/services/billing.service.ts`**
- Added `changePlan()` — calls Paddle `PATCH /subscriptions/:id` with `proration_billing_mode: "do_not_bill"` to schedule a plan switch at the end of the current billing period

**`apps/api/src/routes/billing.routes.ts`**
- Added `POST /billing/change-plan` endpoint — authenticated, validates `{ priceId }`, returns `{ scheduledAt }`

---

### Frontend

**`apps/web/src/components/billing/plan-actions.tsx`**
- Added `ChangePlanButton` component — schedules a plan change at end of period via `POST /billing/change-plan`; shows confirmation message on success

**`apps/web/src/components/billing/billing-plans-grid.tsx`** _(new file)_
- Client component with monthly/yearly billing interval toggle
- Renders plan cards; uses `ChangePlanButton` when org has active subscription, `ChoosePlanButton` for new subscribers

**`apps/web/src/app/(dashboard)/app/billing/page.tsx`**
- Uses `BillingPlansGrid` (replaces inline plan cards)
- Plan label now pulled from catalog so it reflects admin overrides
- Section title changes from "Plans" → "Switch plan" / "Choose a plan" based on subscription state
- Added note: "Plan changes take effect at the end of your current billing period."

**`apps/web/src/components/billing/checkout-plans.tsx`**
- Added `interval` state (monthly/yearly toggle) to the manual plan-picker grid
- `subscribe()` receives interval and selects the correct price ID
- Shows yearly equivalent per-month price when yearly is selected

**`apps/web/src/components/ns/homepage-34/Pricing.tsx`**
- Plan names and prices updated to match new catalog
- Feature comparison table updated to reflect actual product features (AI messages, websites, knowledge sources, team members, priority support)
- Added monthly/yearly billing interval toggle
- Yearly per-month equivalent shown when yearly is selected

**`apps/web/src/app/(marketing)/pricing/page.tsx`**
- `CatalogPlan` type extended with `priceYearlyUsd`

**`apps/web/src/components/ns/pages/pricing-page-content.tsx`**
- `CatalogPlan` type updated to include `priceYearlyUsd`

---

### Admin

**`apps/web/src/components/admin/utils.ts`** and **`apps/admin/src/components/admin/utils.ts`**
- `PLAN_PRICES` updated: starter→70, pro→199, enterprise→399
- Added `PLAN_LABELS` map and `planLabel()` helper (web version)

---

### Environment Variables

**New vars added to `.env.example` and `.env.prod`:**
- `PADDLE_PRICE_STARTER_YEARLY`
- `PADDLE_PRICE_PRO_YEARLY`
- `PADDLE_PRICE_ENTERPRISE_YEARLY`
- `NEXT_PUBLIC_PADDLE_PRICE_STARTER_YEARLY`
- `NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY`
- `NEXT_PUBLIC_PADDLE_PRICE_ENTERPRISE_YEARLY`
