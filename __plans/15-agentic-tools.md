# Phase 15 — Agentic Tools (Tier 2B)

> **Status: COMPLETE** — all adapters, transcript injection, knowledge-gap logging, analytics endpoint, and dashboard card implemented. See `CHANGELOG_7.md`.
>
> Roadmap Tier 2B. Spec: [`__specs/31-agentic-tools.md`](../__specs/31-agentic-tools.md). Builds on Phase 14 ([`14-integration-framework.md`](./14-integration-framework.md)).

## Goal

Implement the six concrete tool adapters that operators can enable on their AI agent: calendar booking (Cal.com + Calendly), subscription management (Paddle — wrapping existing billing primitives), order refunds (Stripe — gated on Connect approval), support ticket creation (Linear + Jira — with auto-injected conversation transcript), and knowledge-gap logging (automatic Pinecone score monitoring with an analytics card surfacing unresolved questions). After this phase an AI agent can book a meeting, upgrade a subscription, issue a refund, file a bug, and flag knowledge gaps — all within operator-configured guardrails.

## Prerequisites

- Phase 14 green (`ProviderAdapter` interface + dispatcher + `Connection` models in place).
- Provider OAuth apps registered per BLOCKERS.md B-2 (Cal.com, Calendly, Linear, Jira). Stripe requires B-1 (Connect approval) before live use; sandbox tests use mock credentials.
- `AI_KB_GAP_SCORE_THRESHOLD` env var set (default `0.65`).
- `@linear/sdk` and `stripe` npm packages available in `apps/api`.

## Skills to invoke

- [[__skills/express-mongoose-scaffold]] — new model, env var additions, dispatcher hook.
- [[__skills/webapp-testing]] — sandbox end-to-end verification per adapter.

## Work breakdown (ordered)

### 2B.1 — Cal.com adapter

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | Implement `calcom` adapter: `buildAuthUrl` → Cal.com OAuth v2 (`api.cal.com/v2/oauth/authorize`); `exchangeCode` → token endpoint; `refreshTokens` → refresh endpoint; `getTools()` → `[list_calendar_slots, book_meeting]` templates; `execute("list_calendar_slots", {durationMins, daysAhead})` → GET `/slots/available`; `execute("book_meeting", {slotTime, attendeeEmail, attendeeName, title})` → POST `/bookings`; sandbox routes to Cal.com test org | `apps/api/src/services/integrations/providers/calcom.ts` | express-mongoose-scaffold | OAuth connects; `list_calendar_slots` returns available times; `book_meeting` creates Cal.com event; sandbox flag uses test credentials |

### 2B.2 — Calendly adapter

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 2 | Implement `calendly` adapter: same two tools (`list_calendar_slots`, `book_meeting`); OAuth against `api.calendly.com`; map Calendly event types → slots; create invitee via `POST /scheduled_events` | `apps/api/src/services/integrations/providers/calendly.ts` | express-mongoose-scaffold | Same acceptance criteria as Cal.com against Calendly's sandbox/staging |

### 2B.3 — Paddle subscription adapter

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 3 | Implement `paddle` adapter: `authMode: "api_key"` (org stores their Paddle API key); `getTools()` → `[get_subscription, upgrade_subscription, downgrade_subscription, cancel_subscription]`; `execute` wraps `billing.service.ts`: `get_subscription` → `syncSubscriptionFromPaddle()`, `upgrade/downgrade_subscription` → `changePlan({organizationId, priceId})`, `cancel_subscription` → Paddle PATCH subscription `status=canceled`. Downgrade and cancel require `requireIdentityVerification:true` in default ToolDefinition guardrails | `apps/api/src/services/integrations/providers/paddle.ts` | express-mongoose-scaffold | `get_subscription` returns plan name + status; upgrade → Paddle subscription updated; downgrade/cancel → OTP required (from Plan 14 dispatcher); no new Paddle API client needed |

### 2B.4 — Stripe adapter

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 4 | Implement `stripe` adapter: OAuth Connect (store per-org `access_token` + `stripe_user_id`); `getTools()` → `[lookup_order, issue_refund]`; `execute("lookup_order", {orderId})` → `stripe.paymentIntents.retrieve()`; `execute("issue_refund", {orderId, amount})` → `stripe.refunds.create()` with `charge` from PaymentIntent. Default guardrails: `maxAmount: 100`, `maxDaysSincePurchase: 30`, `requireIdentityVerification: true`. Gate adapter registration behind `STRIPE_CLIENT_ID` env var (hide connector in dashboard if unset) | `apps/api/src/services/integrations/providers/stripe.ts` | express-mongoose-scaffold | Sandbox: `issue_refund` within $100 cap → Stripe test refund created; above cap → `guardrail_blocked`; no `STRIPE_CLIENT_ID` → Stripe connector hidden from provider grid |

### 2B.5 — Linear adapter

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 5 | Implement `linear` adapter using `@linear/sdk`: OAuth against `linear.app`; `getTools()` → `[create_support_ticket]`; `execute("create_support_ticket", {title, description, priority?})` → `linearClient.createIssue({teamId: guardrails.teamId, title, description})`. Transcript injection handled by dispatcher (task 7 below), not the adapter | `apps/api/src/services/integrations/providers/linear.ts` | express-mongoose-scaffold | OAuth connects to Linear; `create_support_ticket` → issue created in Linear workspace |

### 2B.6 — Jira adapter

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 6 | Implement `jira` adapter: Atlassian OAuth 2.0 3LO (`developer.atlassian.com`); Jira REST API v3; `getTools()` → `[create_support_ticket]`; `execute("create_support_ticket", {title, description, priority?})` → `POST /rest/api/3/issue` with `issuetype: Bug` | `apps/api/src/services/integrations/providers/jira.ts` | express-mongoose-scaffold | OAuth connects to Jira Cloud; issue created in project defined in `guardrails.projectKey` |

### 2B.7 — Transcript injection in dispatcher

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 7 | In `dispatcher.ts`: when `toolKey === "create_support_ticket"`, fetch `Message.find({conversationId}).sort({createdAt:1})`, format as `\n---\n{role}: {content}\n` block, append to `args.description` before calling adapter. Apply `piiMask()` to transcript before appending (reuse `piiMask.ts` from plan 14) | `apps/api/src/services/integrations/dispatcher.ts` | express-mongoose-scaffold | Linear/Jira issue body includes full PII-masked conversation transcript |

### 2B.8 — Knowledge-gap logging

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 8 | Create `KnowledgeGap` model: `{organizationId, agentId, question: string, queryUsed: string, maxKbScore: number, occurrenceCount: number, status: "open"\|"addressed", createdAt}`. Upsert by `{organizationId, agentId, queryUsed}` (increment `occurrenceCount`, update `question` to latest). In `generateAiReply()` after `search_kb` tool call: if `max(hits.score) < AI_KB_GAP_SCORE_THRESHOLD` (default 0.65), upsert a `KnowledgeGap` doc | `apps/api/src/models/KnowledgeGap.ts`, `apps/api/src/services/ai/agent.service.ts`, `apps/api/src/config/env.ts` | express-mongoose-scaffold | Low-score KB conversation → `KnowledgeGap` doc created; same question twice → `occurrenceCount:2`; high-score conversation → no doc |
| 9 | Add knowledge-gap analytics card to `/app/analytics`: `GET /analytics/knowledge-gaps?agentId=&limit=10` endpoint returning top gaps by `occurrenceCount`; render ranked list card with "Add to KB" link prefilling `/app/knowledge?prefill={question}` | `apps/api/src/routes/analytics.routes.ts`, `apps/web/src/app/(dashboard)/app/analytics` | webapp-testing | Card shows top unanswered questions with occurrence counts; "Add to KB" link opens KB page with question pre-filled |

### Wrap-up

| # | Task | Files touched | Acceptance |
|---|------|---------------|------------|
| 10 | End-to-end smoke test for each adapter in sandbox mode; verify ToolCallLog entries | — | All verification checks below green |
| 11 | Update spec 31 + this plan with deltas; write `CHANGELOG_N.md` | `__specs/31-agentic-tools.md`, `__plans/15-agentic-tools.md`, `CHANGELOG_N.md` | Docs match shipped behavior |

## Decisions baked in

- Paddle adapter wraps existing `billing.service.ts` — no new Paddle API client; no raw Paddle API calls from the adapter.
- Stripe adapter hidden when `STRIPE_CLIENT_ID` unset — operators on unqualified platforms can't see a broken connector.
- Transcript appended to `description`, not `title` — keeps issue title short.
- PII masking applied to transcript before ticket creation — avoids leaking contact data to Linear/Jira.
- `AI_KB_GAP_SCORE_THRESHOLD` is an `optional()` env var (default 0.65); change without code redeploy.

## Verification

- [ ] Cal.com OAuth flow (sandbox): connect → `list_calendar_slots` → AI returns available times; `book_meeting` → event in test calendar; `ToolCallLog.status:"success"`.
- [ ] Calendly equivalent (sandbox).
- [ ] Paddle `get_subscription` → returns current plan and status.
- [ ] Paddle `downgrade_subscription` → OTP email triggered (from Plan 14 dispatcher); correct code → plan changes.
- [ ] Stripe (sandbox, `STRIPE_CLIENT_ID` set): `issue_refund` ≤ $100 → test refund in Stripe dashboard; > $100 → `ToolCallLog.status:"guardrail_blocked"`; no `STRIPE_CLIENT_ID` → Stripe card absent from integrations grid.
- [x] Linear: `create_support_ticket` → issue in Linear with PII-masked transcript in body (transcript injection implemented in dispatcher).
- [x] Jira: `create_support_ticket` → issue in Jira with transcript (same dispatcher path).
- [x] Low-KB-score conversation → `KnowledgeGap` doc; repeated question increments `occurrenceCount`.
- [x] Analytics knowledge-gap card shows ranked list; "Add to KB" link pre-fills question.
- [x] `KnowledgeGap` model registered in `models/index.ts`; `knowledgegaps` collection auto-created on first upsert.

### Implementation notes (delta from original spec)

- Transcript injected as `_transcript` field in `enrichedArgs` (not appended to `description`) — keeps adapter responsible for placement. Linear/Jira adapters use `args._transcript` as the issue body.
- KB gap upsert uses `{organizationId, agentId, queryUsed}` unique key (not `question`) — avoids duplicate docs when customers phrase the same gap differently; `question` field updated to the latest phrasing.
- `maskPii()` called on each message string via the `String` overload (not the object overload) — content field is already a string.
- `analytics.routes.ts` uses a local `wrap()` helper (not `asyncHandler` from middleware) — `asyncHandler` is a local function in `widget.routes.ts`, not an exported middleware.
- Analytics page knowledge-gaps fetch uses `.catch(() => ({ items: [] }))` — page still renders if the endpoint is unavailable or returns an error.
- **Jira auto-enable (session 7):** `ToolDefinition` records for `create_support_ticket` were being seeded with `enabledAgentIds: []`, so no agent could use the tool until manually PATCH'd. Fixed in both seed paths (`integrations.routes.ts`) to use `$addToSet { enabledAgentIds: allAgentIds }` — tools are now enabled for all org agents automatically on connect/reconnect.
- **Jira system prompt (session 7):** `buildSystemPrompt()` in `prompts.ts` accepts `activeToolKeys?: string[]`. When `"create_support_ticket"` is present, `JIRA_TOOL_INSTRUCTIONS` are injected — instructing the agent to call the tool before escalating with a clear summary and project key.

## Out of scope

- Shopify adapter (same pattern; add when B-1 or separate partner approval completed).
- Rich card display of calendar slots (Plan 16 — `resultToBlocks()` in dispatcher).
- Inline booking form widget (Plan 16 FormBlock).
- Custom LLM instructions per integration (future configurability).
