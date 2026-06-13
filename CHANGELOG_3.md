# Changelog 3

## Plan Key Rename + Free Plan Removal

### Summary

Internal plan keys now match their display names. The `free` plan has been removed entirely — new organizations have no plan until they subscribe.

| Old key | New key | Display name |
|---|---|---|
| `starter` | `pro` | Pro |
| `pro` | `business` | Business |
| `enterprise` | `enterprise` | Enterprise |
| `free` | *(removed)* | — |

### Environment Variable Renames

| Old var | New var |
|---|---|
| `PADDLE_PRICE_STARTER` | `PADDLE_PRICE_PRO` |
| `PADDLE_PRICE_STARTER_YEARLY` | `PADDLE_PRICE_PRO_YEARLY` |
| `PADDLE_PRICE_PRO` | `PADDLE_PRICE_BUSINESS` |
| `PADDLE_PRICE_PRO_YEARLY` | `PADDLE_PRICE_BUSINESS_YEARLY` |
| `NEXT_PUBLIC_PADDLE_PRICE_STARTER` | `NEXT_PUBLIC_PADDLE_PRICE_PRO` |
| `NEXT_PUBLIC_PADDLE_PRICE_STARTER_YEARLY` | `NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY` |
| `NEXT_PUBLIC_PADDLE_PRICE_PRO` | `NEXT_PUBLIC_PADDLE_PRICE_BUSINESS` |
| `NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY` | `NEXT_PUBLIC_PADDLE_PRICE_BUSINESS_YEARLY` |

Updated in `.env`, `.env.prod`, `.env.example`.

---

### Backend

**`apps/api/src/config/plans.ts`**
- `Plan` type changed: `"free" | "starter" | "pro" | "enterprise"` → `"pro" | "business" | "enterprise"`
- `PLAN_LIMITS` keys renamed accordingly; `free` entry removed
- `PLAN_DISPLAY_NAMES` updated (no `free` entry)
- `limitsForPlan()` now accepts `string | null | undefined`; returns `UNSUBSCRIBED_LIMITS` (all zeros) when no plan set
- `defaultPlanCatalog()` entries: `starter`→`pro`, `pro`→`business`; env vars renamed to match
- Fallback in `planByPriceId()` was `"starter"` → now `"pro"`

**`apps/api/src/models/Organization.ts`**
- `plan` enum: `["pro", "business", "enterprise"]`; `required` and `default: "free"` removed — field is now optional

**`apps/api/src/models/Subscription.ts`**
- `plan` enum: `["pro", "business", "enterprise"]`

**`apps/api/src/models/PlatformSetting.ts`**
- Plan override enum: `["pro", "business", "enterprise"]`

**`apps/api/src/middleware/plan-limit.middleware.ts`**
- `planFor()` returns `string | null` (was `Plan`)
- `requirePaidPlan()` checks `!org?.plan` instead of `=== "free"`

**`apps/api/src/routes/billing.routes.ts`**
- Plan fallback in subscription and usage responses: `"free"` → `null`

**`apps/api/src/routes/admin.routes.ts`**
- Subscription filter: `["starter","pro","enterprise"]` → `["pro","business","enterprise"]`
- Organization filter: `["free","starter","pro","enterprise"]` → `["pro","business","enterprise"]`
- Campaign conversion metric: `$ne: ["$plan","free"]` → `$in: ["$plan", ["pro","business","enterprise"]]`
- Plan entry schema (admin settings): `z.enum(["free","starter","pro","enterprise"])` → `z.enum(["pro","business","enterprise"])`

**`apps/api/src/services/auth.service.ts`**
- Removed `plan: "free"` from both `Organization.create()` calls (credentials + Google OAuth signup)

**`apps/api/src/services/billing.service.ts`**
- Fallback when Paddle price ID not found: `"starter"` → `"pro"`
- When subscription is cancelled/paused: org plan is now `$unset` (instead of set to `"free"`)

---

### Frontend

**`apps/web/src/components/billing/billing-plans-grid.tsx`**
- `BillingCatalogEntry.plan` type: `"pro" | "business" | "enterprise"`
- `currentPlan` prop accepts `string | null`
- Highlighted (featured) plan: `"pro"` → `"business"` (middle tier)
- Fixed `setInterval` / `interval` state name shadowing global `window.setInterval` → renamed to `setBillingInterval` / `billingInterval`

**`apps/web/src/components/billing/checkout-plans.tsx`**
- `Plan.plan` type: `"pro" | "business" | "enterprise"`
- `defaultHighlight`: `"pro"` → `"business"`

**`apps/web/src/components/billing/plan-actions.tsx`**
- `Plan.id` type: `"pro" | "business" | "enterprise"`

**`apps/web/src/app/(dashboard)/app/billing/page.tsx`**
- `Subscription.plan` type: `"pro" | "business" | "enterprise" | null`
- Plan fallback: `"free"` → `null`
- Label: `plan === "free"` → `!plan`
- Catalog filter for `p.plan !== "free"` removed (no free plans in catalog)

**`apps/web/src/app/(dashboard)/app/usage/page.tsx`**
- `UsageResponse.plan` type: `"pro" | "business" | "enterprise" | null`

**`apps/web/src/app/(auth)/register/page.tsx`**
- `VALID_PLANS`: `['starter','pro','enterprise']` → `['pro','business','enterprise']`

**`apps/web/src/components/ns/homepage-34/Pricing.tsx`**
- `tier` values: `'starter'`→`'pro'`, `'pro'`→`'business'`
- Fixed `setInterval` / `interval` state name shadowing → renamed to `setBillingInterval` / `billingInterval`

**`apps/web/src/components/admin/utils.ts`** and **`apps/admin/src/components/admin/utils.ts`**
- `PLAN_PRICES`: `{ starter:70, pro:199 }` → `{ pro:70, business:199 }`
- `PLAN_LABELS` (web): `{ free:"Free", starter:"Pro", pro:"Business" }` → `{ pro:"Pro", business:"Business" }`
- `AdminSubscription.plan` type: `"pro" | "business" | "enterprise"`

---

### Database Migration

Ran against the `customer-support` database:

```js
// Step 1 — rename pro→business first to avoid collision
db.organizations.updateMany({plan:"pro"}, {$set:{plan:"business"}})     // 0 docs (none were on old "pro")
db.subscriptions.updateMany({plan:"pro"}, {$set:{plan:"business"}})     // 0 docs

// Step 2 — rename starter→pro
db.organizations.updateMany({plan:"starter"}, {$set:{plan:"pro"}})      // 2 docs
db.subscriptions.updateMany({plan:"starter"}, {$set:{plan:"pro"}})      // 3 docs

// Step 3 — remove free plan from orgs (unsubscribed state = no plan field)
db.organizations.updateMany({plan:"free"}, {$unset:{plan:1}})           // 4 docs
```

Post-migration state:
- 6 organizations have a plan set (`pro` or `enterprise`); 4 unsubscribed orgs have no `plan` field
- 7 subscriptions: all `pro` or `enterprise`, all `status: "active"`
- No stale `starter`, `free`, or old `pro` values remain
