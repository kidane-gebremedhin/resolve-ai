# Changelog 4

## USD-Based Usage Tracking, Budget Limits & Enforcement

### Summary

Added end-to-end AI spending visibility and enforcement:
- Every LLM call's actual USD cost is fetched from OpenRouter's `/generation` API and stored per conversation turn.
- Admin portal has a new **Budget & Limits** table to set per-plan monthly caps (org-level and per-website).
- Strict enforcement returns `402 budget_limit_exceeded` when a cap is hit, with an upgrade URL.
- Email alerts are sent automatically at **75%** and **100%** of each budget threshold.
- The `/app/usage` dashboard now shows USD spend, per-website breakdown, and a daily cost chart.

---

### New Models

**`apps/api/src/models/UsageRecord.ts`** — new collection
- One record per `generateAiReply` invocation (aggregates all LLM calls in the turn)
- Fields: `organizationId`, `websiteId`, `conversationId`, `generationIds[]`, `model`, `promptTokens`, `completionTokens`, `totalTokens`, `costUsd`, `period` (YYYY-MM)
- Indexes: `(organizationId, period)`, `(websiteId, period)`; TTL auto-delete after 2 years

**`apps/api/src/models/BudgetAlert.ts`** — new collection
- Tracks which threshold alerts have already been sent per entity × period × threshold
- Unique index on `(entityId, period, threshold)` to prevent duplicate emails
- TTL auto-delete after 90 days

---

### Model Changes

**`apps/api/src/models/PlatformSetting.ts`**
- Added `budgetLimits` array: `[{ plan, orgMonthlyLimitUsd, websiteMonthlyLimitUsd }]`
- 0 = no cap (unlimited)

**`apps/api/src/models/index.ts`**
- Exports `UsageRecord` and `BudgetAlert`

---

### Config Changes

**`apps/api/src/config/plans.ts`**
- Added `DEFAULT_BUDGET_LIMITS` (code defaults): Pro ($50 org/$10 website), Business ($200 org/$25 website), Enterprise (unlimited)
- Added `budgetLimitsForPlan(plan)` — resolves effective limits from PlatformSetting override or code defaults

---

### New Services

**`apps/api/src/services/openrouter-usage.service.ts`**
- `recordConversationUsage({ generationIds, organizationId, websiteId, conversationId, model })` — fire-and-forget after each agent reply
- Fetches cost from `GET /generation?id=<id>` for each generationId (retries up to 5×, 2s apart)
- Persists one aggregated `UsageRecord`; then triggers budget alert checks

**`apps/api/src/services/budget-alert.service.ts`**
- `checkAndSendBudgetAlerts({ organizationId, websiteId, period })` — called after every UsageRecord save
- Sends email to org admin/owners at 75% and 100% thresholds (once per threshold per period)
- Includes current spend, budget cap, and a billing upgrade link in the email body
- Also exports `monthlyOrgSpend(orgId, period)` and `monthlyWebsiteSpend(websiteId, period)` for middleware

---

### New Middleware

**`apps/api/src/middleware/budget-limit.middleware.ts`**
- `enforceBudgetLimit(req, res, next)` — runs after `enforceMessageQuota` on POST `/widget/conversations/:id/messages`
- Skips if org has no plan (unsubscribed — already blocked by message quota)
- Checks org monthly spend vs `orgMonthlyLimitUsd`
- Checks website monthly spend vs `websiteMonthlyLimitUsd` (via `req.contactSessionId → ContactSession.websiteId`)
- Returns `402 { code: "budget_limit_exceeded", spentUsd, limitUsd, upgradeUrl }`

---

### AI Service Changes

**`apps/api/src/services/ai/agent.service.ts`**
- Extended `LlmResponse` type to include `id` (generation ID) and `usage` fields
- `callLlm` now returns `{ choice, generationId }` instead of just `choice`
- `generateAiReply` accumulates all `generationId`s across the tool-loop and final call
- After saving the AI message, fires `recordConversationUsage` as a fire-and-forget task

---

### Route Changes

**`apps/api/src/routes/billing.routes.ts`** — new endpoints
- `GET /billing/usage/cost` — current-month org spend + budget limits
- `GET /billing/usage/cost/websites` — per-website spend breakdown for current month
- `GET /billing/usage/cost/daily?days=30` — daily USD cost time series (gap-filled)

**`apps/api/src/routes/admin.routes.ts`** — new endpoints + schema
- `GET /admin/usage/cost?period=YYYY-MM` — platform-wide cost totals + top-20 orgs by spend
- Extended `platformSettingsPatchSchema` with `budgetLimits` array
- `PATCH /admin/settings` now persists `budgetLimits` wholesale (same pattern as `plans`)
- Imports `UsageRecord` model

**`apps/api/src/routes/widget.routes.ts`**
- Added `enforceBudgetLimit` middleware to `POST /widget/conversations/:id/messages` (after `enforceMessageQuota`)

---

### Frontend Changes

**`apps/web/src/app/(dashboard)/app/usage/page.tsx`**
- Now fetches 5 endpoints in parallel: usage, daily, cost, cost/websites, cost/daily
- New "AI Spending" section with:
  - Org-level spend card with progress bar vs budget
  - Per-website spend list with per-site progress bars
  - Daily cost bar chart (30 days)
- Banner alerts for "approaching budget" (≥75%) and "budget exceeded" (≥100%)

**`apps/admin/src/components/admin/budget-limits-form.tsx`** — new component
- Client component with an editable table: Plan | Org budget/mo | Website budget/mo
- `PATCH /admin/settings` on save
- Shows "unlimited" label when a cap is 0

**`apps/admin/src/app/(admin)/settings/page.tsx`**
- Now loads `budgetLimits` from `/admin/settings` and passes it to `BudgetLimitsForm`
- Added `BudgetLimitsForm` below the existing `FontPreferences` component

---

### Error Response

When a budget cap is hit, the API returns:
```json
{
  "error": {
    "code": "budget_limit_exceeded",
    "message": "Your organization has reached its monthly AI spending budget.",
    "kind": "org",
    "spentUsd": 50.0012,
    "limitUsd": 50,
    "upgradeUrl": "/app/billing"
  }
}
```
HTTP status: **402 Payment Required**
