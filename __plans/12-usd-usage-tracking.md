# Phase 12 — USD-Based Usage Tracking, Budget Limits & Enforcement

## Goal

Every LLM call's actual USD cost is captured from OpenRouter, stored per conversation turn, surfaced on the usage dashboard and admin portal, and enforced via hard budget caps with email alerts.

## Deliverables

| # | Deliverable | Files | Status |
|---|-------------|-------|--------|
| 1 | `UsageRecord` model — one doc per `generateAiReply` turn; stores tokens, costUsd, period | `apps/api/src/models/UsageRecord.ts` | ✅ Done |
| 2 | `BudgetAlert` model — deduplication guard for sent threshold emails | `apps/api/src/models/BudgetAlert.ts` | ✅ Done |
| 3 | `PlatformSetting.budgetLimits` — admin-configurable per-plan caps | `apps/api/src/models/PlatformSetting.ts` | ✅ Done |
| 4 | `DEFAULT_BUDGET_LIMITS` + `budgetLimitsForPlan()` in plans config | `apps/api/src/config/plans.ts` | ✅ Done |
| 5 | OpenRouter `/generation` cost fetcher with retry | `apps/api/src/services/openrouter-usage.service.ts` | ✅ Done |
| 6 | Budget alert service (75% + 100% thresholds, email) | `apps/api/src/services/budget-alert.service.ts` | ✅ Done |
| 7 | `enforceBudgetLimit` middleware — 402 when cap hit | `apps/api/src/middleware/budget-limit.middleware.ts` | ✅ Done |
| 8 | `agent.service.ts` — captures generationIds, fires usage recording | `apps/api/src/services/ai/agent.service.ts` | ✅ Done |
| 9 | Widget route — `enforceBudgetLimit` applied | `apps/api/src/routes/widget.routes.ts` | ✅ Done |
| 10 | Billing routes — `/usage/cost`, `/usage/cost/websites`, `/usage/cost/daily` | `apps/api/src/routes/billing.routes.ts` | ✅ Done |
| 11 | Admin routes — `GET /admin/usage/cost`, `budgetLimits` in PATCH /settings | `apps/api/src/routes/admin.routes.ts` | ✅ Done |
| 12 | Usage page — USD spend section, per-website breakdown, daily cost chart | `apps/web/src/app/(dashboard)/app/usage/page.tsx` | ✅ Done |
| 13 | Admin Budget & Limits form | `apps/admin/src/components/admin/budget-limits-form.tsx` | ✅ Done |
| 14 | Admin settings page — includes BudgetLimitsForm | `apps/admin/src/app/(admin)/settings/page.tsx` | ✅ Done |

## Default Budget Limits (code)

| Plan | Org / month | Website / month |
|------|-------------|-----------------|
| Pro | $50 | $10 |
| Business | $200 | $25 |
| Enterprise | Unlimited | Unlimited |

Admin can override these via the "Budget & Limits" table in `/admin/settings`.

## Cost Capture Flow

```
Customer message
  → POST /widget/conversations/:id/messages
  → enforceMessageQuota  (count-based)
  → enforceBudgetLimit   (USD-based)
  → Message.create()     (customer msg)
  → generateAiReply()    [fire-and-forget]
      → callLlm() × N   (returns generationId per call)
      → Message.create() (AI msg)
      → recordConversationUsage()  [fire-and-forget]
          → fetchGeneration(id) × N  (OpenRouter /generation, 5 retries)
          → UsageRecord.create()
          → checkAndSendBudgetAlerts()
              → BudgetAlert.create()  (idempotent, unique constraint)
              → sendMail() to org admins
```

## Error Response (budget exceeded)

```json
HTTP 402
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
