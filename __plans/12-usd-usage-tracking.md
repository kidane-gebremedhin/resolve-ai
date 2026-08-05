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
| 15 | `UsageRecord.feature` + generalized `recordUsage()` recorder | `apps/api/src/models/UsageRecord.ts`, `apps/api/src/services/openrouter-usage.service.ts` | ✅ Done |
| 16 | Meter operator reply suggestions | `apps/api/src/services/ai/suggestions.service.ts` | ✅ Done |
| 17 | Meter operator draft enhance/polish | `apps/api/src/services/ai/enhance.service.ts`, `apps/api/src/routes/message.routes.ts` | ✅ Done |
| 18 | Meter support-ticket issue-scoping | `apps/api/src/services/ai/ticket-transcript.service.ts`, `apps/api/src/services/integrations/dispatcher.ts` | ✅ Done |
| 19 | Meter KB embeddings (token-priced) | `apps/api/src/services/ai/embedding.service.ts` + kb search/ingestion/firecrawl callers | ✅ Done |
| 20 | 50% threshold added (was 75/100) | `apps/api/src/services/budget-alert.service.ts`, `apps/api/src/models/BudgetAlert.ts` | ✅ Done |
| 21 | In-app notifications (model + service + routes + bell) | `apps/api/src/models/Notification.ts`, `services/notification.service.ts`, `routes/notification.routes.ts`, `apps/web/.../notification-bell.tsx` | ✅ Done |
| 22 | Threshold alerts delivered as BOTH email + in-app notification | `apps/api/src/services/budget-alert.service.ts` | ✅ Done |
| 23 | Gate operator AI (suggestions, enhance) when org over budget | `apps/api/src/middleware/budget-limit.middleware.ts` (`enforceOrgBudget`), conversation/message routes | ✅ Done |
| 24 | Gate KB embedding jobs (ingestion + crawl) when org over budget | `apps/api/src/services/kb/ingestion.service.ts`, `firecrawl.service.ts` | ✅ Done |
| 25 | Widget shows generic error to customer on 402 (no budget wording) | `apps/widget/src/lib/api-client.ts` | ✅ Done |

## Enforcement is now account-wide (not just the widget)

Originally only the widget message path returned a 402 when over budget. Now spend is stopped
everywhere once the **org** cap is hit:

| Surface | Gate | Behaviour when over budget |
|---------|------|----------------------------|
| Widget customer message | `enforceBudgetLimit` (org + website) | 402 → widget shows a **generic** "please try again later" (never the budget amounts) |
| Operator reply suggestions | `enforceOrgBudget` | 402 with a clear operator message |
| Operator draft enhance | `enforceOrgBudget` | 402 with a clear operator message |
| KB ingestion / crawl embeddings | `orgBudgetStatus()` guard | source parked in `error` with a clear reason; a later retry (post-reset/upgrade) succeeds |

`orgBudgetStatus(orgId)` (in `budget-alert.service.ts`) is the shared read used by the operator/KB
gates. Website-level caps still apply only on the widget path (customer traffic attribution);
operator/KB actions gate on the org cap (the account-holder budget).

## Threshold alerts → email + in-app notification

`checkAndSendBudgetAlerts` runs from **two triggers**: (1) as a side-effect of recording usage
(organic growth through 50/75/100%), and (2) from the enforcement middleware whenever a request is
**blocked** for being over budget (`enforceBudgetLimit` / `enforceOrgBudget`) — because once
blocked, no usage is recorded, so trigger (1) alone would never notify (esp. when a limit is
set/lowered below existing spend). The block trigger is throttled in-memory (once per
org+website+period / 60s); the DB dedup still guarantees no duplicate sends.

It fires at **50 / 75 / 100%** (was 75/100). Each threshold is sent once per period
(`BudgetAlert` unique guard) and delivered TWO ways:
1. **Email** to every org owner/admin (unchanged copy/template).
2. **One org-wide in-app notification**, pushed live over the socket `org:<organizationId>` room
   and surfaced by the dashboard header bell.

### In-app notification system (new, reusable, ORG-WIDE)
- **Model** `Notification` — **org-scoped** (one doc per event, shared read state across the org),
  `type`/`level`/`title`/`body`/`link`/`read` + optional `agentId`/`websiteId`, 90-day TTL.
- **Service** `notification.service.ts` — `createNotification` (persist + socket emit to
  `org:<organizationId>`), `orgAdminEmails` (email recipients).
- **Routes** `GET /notifications` (list + unreadCount), `POST /notifications/:id/read`,
  `POST /notifications/read-all` — all scoped to the caller's **org**.
- **UI** `NotificationBell` — replaces the old static header bell; initial fetch + live
  `notification:new` socket updates, unread badge, per-item + mark-all read.
- **Agent deep-linking** — a notification with `agentId`/`websiteId` (e.g. website-level budget
  alerts) links to `/app/ai`; the bell sets the `csb_website` scope cookie to that website before
  navigating so the AI page opens the corresponding agent. Org-level alerts → `/app/billing`.

## Full Coverage — every AI/token spend is metered

Originally only the widget agent reply (`recordConversationUsage`) was metered, so
operator-side AI and embeddings escaped both the usage dashboard and budget totals.
Now **every** LLM/embedding call records a `UsageRecord`, tagged with a `feature`:

| `feature` | Source | Cost source |
|-----------|--------|-------------|
| `widget_reply` | customer-facing agent turn (tool loop + final reply) | OpenRouter `/generation` per id |
| `suggestions` | operator reply suggestions | OpenRouter `/generation` (response `id`) |
| `enhance` | operator draft polish | OpenRouter `/generation` (response `id`) |
| `ticket_summary` | support-ticket issue-scoping transcript | OpenRouter `/generation` (response `id`) |
| `embedding` | KB search + ingestion + crawl embeddings | token count × `EMBEDDING_COST_PER_1M_TOKENS` (OpenAI has no `/generation`) |

`recordUsage()` is the single recorder: pass `generationIds` (chat calls) OR direct
`promptTokens`/`costUsd` (embeddings). It persists the record and runs
`checkAndSendBudgetAlerts()`. All call sites fire-and-forget so metering never blocks
or fails the user-facing path.

**Enforcement scope (unchanged):** the `enforceBudgetLimit` 402 gate still only guards
the widget message path — but because `monthlyOrgSpend`/`monthlyWebsiteSpend` sum *all*
`UsageRecord`s, that gate now reflects total org spend (operator AI + embeddings
included), so budgets are accurate. Operator suggestions/enhance and KB ingestion are
metered but not themselves blocked when over budget (they're internal/operator actions).

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
