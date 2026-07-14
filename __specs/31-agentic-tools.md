# 31 — Agentic Tools: Tier 2B Connectors

> **Status**: COMPLETE — implemented in Phase 15. See `CHANGELOG_7.md` and `__plans/15-agentic-tools.md`.
> **Depends on**: spec 30 (integration framework) fully implemented
> **Blocks**: spec 32 item 3.1 (calendar card display requires rich message blocks)
> **Implementation plan**: [`__plans/15-agentic-tools.md`](../__plans/15-agentic-tools.md)

## Implementation Notes

### No tracking link after a ticket (Changelog 14)
`JIRA_TOOL_INSTRUCTIONS` now tell the model to briefly confirm a ticket was logged
but NOT to share a link, tracking URL, or ticket ID. Belt-and-suspenders: the
model-facing `create_support_ticket` result is passed through `stripUrlKeys()`
(agent.service.ts) which recursively removes `url`/`browseUrl` (covers Jira's
top-level `url` and Linear's nested `issue.url`), so no link is even available to
append. The full result (with URL) is still written to the audit log by the
dispatcher, independently.

### Attendee name for booking + named-attendee guardrail (Changelog 14)
The `requireNamedAttendee` guardrail checks `args.name`, but `name`/`attendeeName`
were in `FORM_SKIP_FIELDS` (assumed injected from `ContactSession.name`, which is
almost always empty) — so the guardrail blocked every booking. They are no longer
skipped: when `book_meeting` is called without a `name`, `missingCustomerFields`
flags it and the inline auto-form collects the attendee's real name, which both
satisfies the guardrail and is required by Cal.com regardless.

**Default ON + generic fallback (Changelog 1).** `requireNamedAttendee` now defaults
to **true** (the `ToolDefinition.guardrails` schema default and the Guardrails-editor
checkbox), so new Cal.com connections capture the customer's real name out of the
box. When an operator explicitly turns it **off**, a nameless booking is allowed and
the Cal.com adapter books under the generic attendee name **"Customer"** (Cal.com
rejects a blank attendee name).

**Inline-form hidden values (Changelog 1) — fixes "Submission failed".** The
`book_meeting` auto-form only collects the missing `name`, but the widget re-validates
the submitted payload against the tool's **full** schema (which also requires
`eventTypeId` + `startTime`, chosen earlier from a slot card). Submitting `name` alone
failed that validation → "Submission failed. Please try again." The form block now
carries the model's already-resolved args as `hiddenValues` (e.g. `eventTypeId`,
`startTime`); `FormBlockRenderer` merges them into the POST payload so the full schema
validates and the tool dispatches once with the correct values. Masked/placeholder
values (`[EMAIL]`) are stripped from `hiddenValues` so the dispatcher's own injection
still wins.

**ajv strict/format + type coercion (Changelog 2) — the actual "Submission failed"
root cause.** The inline-form submit route (`widget.routes.ts`) and the webhook adapter
compile tool schemas with ajv. `book_meeting`'s `startTime` is `format: "date-time"`
and we don't register `ajv-formats`, so a **strict** ajv *throws* at compile time
("unknown format … ignored") → HTTP 500 on every booking submit. Both ajv instances are
now `{ coerceTypes: true, strict: false }`: `strict:false` stops the unknown-format
throw, and `coerceTypes` lets string form values (all widget inputs are strings)
satisfy numeric/boolean schema fields (a webhook's `quantity: number`,
`expedited: boolean`) — otherwise those also surfaced "Submission failed". The submit
route additionally validates **without `required`** (the form only collects the fields
the customer must supply; the rest are hidden values or dispatcher-injected).

**Steer-to-slots + real-name enforcement (Changelog 2).** In `agent.service`,
`book_meeting` is guarded: (1) if called before a slot exists (no `eventTypeId` /
`startTime`), the tool returns a "call `list_calendar_slots` first" note instead of a
name-only form that could never book — and the model must not claim a booking; (2) when
the named-attendee guardrail is on and the model passes a placeholder/hallucinated name
(`"Customer"`, `"there"`), that name is treated as **missing** so the inline form
collects a real one. Together these stop the "it said it booked but never asked for a
name" failure.

**Webhook inline-form directive (Changelog 2).** The integration-tools prompt layer now
forcefully instructs the model to CALL the matching tool on the first matching turn
(which triggers the inline form) rather than asking for identifiers like an order number
in chat — the previous soft wording let the model ask in chat and never show the form.

**Custom-webhook forms render the FULL operator schema (Changelog 3).** For a custom
webhook the operator's input JSON schema defines exactly the fields to collect, so its
inline form renders **every** property (required + optional), not just the missing
required subset a built-in tool shows. `agent.service` marks which tool keys are backed
by a `webhook` connection (via a populated connection `provider`) and calls
`buildFormBlock` with `skipSystemFields=false` for them — so system-injected field names
(`email`, `timeZone`, …) that only apply to built-in tools are not stripped from the
operator's schema, and optional fields (e.g. a boolean `expedited`, rendered as a Yes/No
select) are always captured. Built-in tools keep the targeted missing-fields form.

**Custom-webhook reliability — "I don't know", no form, hallucination (Changelog 5).**
Three root causes were fixed so a clearly-defined webhook tool actually works:
- **"I don't know" despite a defined tool** — a webhook tool is only offered to an agent
  it is **enabled** for (`enabledAgentIds`), and each agent grounds answers only in its
  own enabled tools. This is operator-controlled by design: after creating a webhook tool,
  enable it on the specific agents that should use it (Integrations → per-agent toggle).
  A tool that isn't enabled for an agent won't be offered to it.
- **No inline form for the input schema** — operators often pasted a *sample* payload
  instead of a JSON Schema, which was coerced to an empty schema (no fields → no form →
  the model guessed args). The connect route now **infers a real object schema from the
  sample** (`normalizeWebhookInputSchema`), so the form renders and inputs are validated.
- **Hallucinated answers** — the prompt's integration-tools layer now adds a *grounding*
  directive: treat a tool's returned JSON as authoritative live data, quote the real
  values, never invent required args just to force a call (leave them blank for the form
  to collect), and state an empty/`error` result plainly instead of fabricating one. The
  webhook adapter also returns clear, non-leaky error messages so the model surfaces a
  truthful failure rather than papering over an opaque one.

### Support-ticket description — concise summary (updated, Changelog 1)
Superseded the earlier full-transcript injection. The dispatcher no longer dumps
the whole conversation into the ticket: `JIRA_TOOL_INSTRUCTIONS` in
`prompts.ts` direct the model to write a **concise, issue-only** `description`
(2–5 sentences). For `create_support_ticket` the dispatcher only overrides the
**project key** with the agent's operator-configured `jiraProjectKey` (per-agent
routing), so tickets land on the right board without leaking unrelated chat.

### Per-agent Jira project (Changelog 1)
`jiraProjectKey` added to the `Agent` model, the agent update route
(`agent.routes.ts`), and the AI editor Tools tab (`agent-editor.tsx`, shown when
a Jira connection exists). The dispatcher injects it as `projectKey` for
`create_support_ticket`.

The editor's project dropdown is populated from `GET /integrations/jira/projects`.
**(Changelog 2)** That endpoint no longer swallows failures: `listProjects` throws
typed errors, and the route proactively refreshes the (~1h) OAuth token, retries once
on a 401, and returns an actionable `reason` alongside `projects` when the list is
empty — `not_connected`, `reconnect_required` (expired token / no client secret to
refresh with), `missing_permission` (no `read:jira-work` scope), `empty` (site has no
projects), or `error`. The editor renders a specific hint per `reason` instead of a
generic "no projects loaded" message.

### Paddle tools — email + plan name (Changelog 1)
Reworked so `get_subscription` / `upgrade_subscription` / `downgrade_subscription`
/ `cancel_subscription` take the customer **email** (optional — injected from the
ContactSession) and a human **plan name**, never raw Paddle IDs. Subscription
resolution is **org-scoped** via `custom_data.organizationId`. See
[`24-paddle-subscriptions.md`](./24-paddle-subscriptions.md).

### Tool-schema safety (Changelog 1)
`agent.service.ts` `safeToolParameters()` coerces every integration tool's
`parameters` to a valid `type: "object"` schema before the LLM request, and the
webhook connect route rejects non-schema input. This prevents a single malformed
tool definition (e.g. a pasted sample response) from causing OpenAI to 400 the
entire `tools` array — which previously forced a tool-less fallback where the
model hallucinated actions.

### Similar-capability tools: dedup + primary/fallback routing (Changelog 1)
When several connected integrations expose the **same tool key** (e.g. Jira and
Linear both offering `create_support_ticket`), the agent must still call the right
tool for each intent and survive one integration failing.

- **Offered once.** `agent.service.ts` groups integration tool defs by `key` and
  pushes a **single** function per key to the LLM (duplicate function names 400 the
  whole `tools` array). The model picks the right tool for an intent from the tool
  **description** (the Tool registry copy). The offered description/schema/guardrails
  come from the key's **primary** connection.
- **Operator-set order.** `Agent.toolPriority: [{ key, connectionIds }]` fixes the
  primary → fallback order per key. Within a key, defs are sorted by the operator's
  `connectionIds` rank, then `createdAt`. The dashboard (**AI agent → Tools →
  Primary & fallback order**) only shows the control when ≥2 **enabled** connections
  share a key, and saves the order via `PATCH /agents/:id`.
- **Fallback on error.** The runtime builds a per-key connection chain and calls
  `dispatchToolCall(name, args, ctx, connectionId)` for the primary; if the result
  is `status: "error"`, it re-dispatches to the next connection in the chain.
  Intentional stops — `guardrail_blocked`, `otp_pending`, `rate_limited` — are
  respected and do **not** fall through.

### Contact email/name injection (Changelog 1)
`book_meeting` and the Paddle subscription tools receive the visitor's verified
email/name from the ContactSession (PII redaction hides them from the model), so
the model never has to ask for — or guess — an email.

### Cal.com visitor timezone (Changelog 5)
The widget captures the visitor's IANA timezone at init (stored on
`ContactSession.metadata.timeZone`); the dispatcher injects it into
`list_calendar_slots`/`book_meeting`; the adapter uses it for the slots query and
the booking attendee timezone; and slot/confirmation cards render in that zone with
its label (e.g. "09:15 AM GMT+3"). The `contactLayer` prompt tells the model to
present all times in the customer's timezone.

### Cal.com event-type resolution + booking fields (Changelog 4)
The model often passes the wrong event-type id (the duration "15" or an index
"1"). `resolveEventType()` validates against the account's real event types
(id → slug/title → duration → first), `list_calendar_slots` returns the resolved
id, and the slot card embeds it so `book_meeting` reuses the exact id. `book_meeting`
also fills any *required* custom booking field (e.g. a required notes field) with a
default to avoid Cal.com's `error_required_field`. The Cal.com API key fixes the
host/calendar, so there is no per-agent host selection. Accordingly, `email` is
**optional** in these tool schemas (`book_meeting` requires only
`eventTypeId, startTime, name`); the model is told the email may appear masked as
`[EMAIL]` and must not re-ask or re-confirm it — otherwise it loops trying to
collect an address it cannot see.

### Generic integration-tools directive (Changelog 1)
`integrationToolsLayer` in `prompts.ts` enumerates every enabled integration tool
(key + description, passed from `agent.service.ts` as `integrationTools`) and
directs the model to CALL the matching tool for account/order/action requests —
a concrete identifier (order ID, email, booking ref) is a strong signal — instead
of searching the KB or replying "I couldn't find that in the knowledge base."
This is what makes **custom webhook connectors** (e.g. `lookup_order`) actually
get used; unlike Jira/Cal.com/Paddle they have no dedicated instruction block.

### Knowledge-gap model (2B.8)
`apps/api/src/models/KnowledgeGap.ts` — unique compound index on `{organizationId, agentId, queryUsed}`. Upsert logic in `agent.service.ts` increments `occurrenceCount` and updates `question` to the latest phrasing (fire-and-forget; errors logged as warnings).

### KB gap detection threshold
Controlled by `AI_KB_GAP_SCORE_THRESHOLD` env var (default `0.65`). Added to `apps/api/src/config/env.ts` as `env.ai.kbGapScoreThreshold` and to `.env.example`.

### Analytics endpoint
`GET /api/v1/analytics/knowledge-gaps` and `PATCH /api/v1/analytics/knowledge-gaps/:id` in `apps/api/src/routes/analytics.routes.ts`, mounted in `routes/index.ts`. Both require `requireAuth` + `requireOrg`.

### Analytics dashboard card
Added to `apps/web/src/app/(dashboard)/app/analytics/page.tsx`. Fetches top 10 open gaps, displays a table with question, occurrence count, max score, and "Add to KB" link prefilling `/app/knowledge?prefill=<question>`. Empty state shown when no gaps logged yet.

---

## Overview

Six connectors built on top of the integration framework spine (spec 30). Each is
a thin provider adapter + tool schema + guardrail configuration. Build in this
order (increasing credential complexity):

| # | Tool | Provider | Credentials needed | Notes |
|---|---|---|---|---|
| 2B.1 | Calendar booking | Cal.com + Calendly | OAuth — register apps | Slot card requires spec 32 rich message |
| 2B.2 | Subscription mgmt | Paddle | ✅ Already configured | Monetizes the widget on day 1 |
| 2B.3 | Refund | Stripe + Paddle | Stripe Connect (long lead) | Gate behind sandbox + caps initially |
| 2B.4 | Order/shipping | Custom webhook | Operator's own | Requires spec 30 webhook connector (2A.4) |
| 2B.5 | Ticket creation | Linear / Jira / Plain | OAuth — register apps | Fallback when AI can't resolve |
| 2B.6 | Knowledge-gap auto-tool | Internal | None | No connector — internal scoring |

---

## 2B.1 — Calendar booking (Cal.com + Calendly)

### Tools exposed
| Tool key | Description | Args |
|---|---|---|
| `list_calendar_slots` | List available booking slots | `{ attendeeEmail?: string, daysAhead?: number }` |
| `book_meeting` | Book a specific slot | `{ slotId: string, attendeeName: string, attendeeEmail: string, notes?: string }` |

### Cal.com adapter — `apps/api/src/services/integrations/providers/calcom.ts`

```typescript
export const CalComAdapter: ProviderAdapter = {
  key: "calcom",
  displayName: "Cal.com",
  authMode: "oauth",
  oauthConfig: {
    authorizeUrl: "https://app.cal.com/oauth/authorize",
    tokenUrl:     "https://app.cal.com/oauth/token",
    scopes:       ["READ_BOOKING", "READ_AVAILABILITY", "MANAGE_BOOKING"],
    clientIdEnv:  "CALCOM_CLIENT_ID",
    clientSecretEnv: "CALCOM_CLIENT_SECRET",
  },
  getTools() {
    return [
      { key: "list_calendar_slots", ... },
      { key: "book_meeting", ... },
    ];
  },
  async execute(toolKey, args, credentials) {
    const { accessToken } = JSON.parse(credentials);
    if (toolKey === "list_calendar_slots") {
      const resp = await fetch("https://api.cal.com/v2/slots", {
        headers: { Authorization: `Bearer ${accessToken}` },
        // ...
      });
      return await resp.json();
    }
    if (toolKey === "book_meeting") {
      const resp = await fetch("https://api.cal.com/v2/bookings", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ slotUid: args.slotId, attendee: { name: args.attendeeName, email: args.attendeeEmail } }),
      });
      return await resp.json();
    }
  },
};
```

Calendly adapter follows the same pattern against `https://api.calendly.com/`.

### Slot display
When the AI calls `list_calendar_slots`, the result contains slot data. The model
should emit a **card block** (spec 32 § 3.1) displaying 3–5 selectable slots. The
customer taps a slot → sends "I'd like [slot]" as a message → AI calls `book_meeting`.

Until spec 32 rich messages are implemented, the AI falls back to listing slots
as a markdown bullet list.

### Guardrails
```json
{
  "businessHoursUtc": { "start": 9, "end": 18, "days": [1,2,3,4,5] },
  "allowedAttendeeIds": []   // empty = any attendee
}
```

### User actions required
1. Register an OAuth application at `app.cal.com/settings/developer/oauth-clients`.
2. Set redirect URI to `{API_BASE_URL}/api/v1/integrations/calcom/callback`.
3. Add `CALCOM_CLIENT_ID` and `CALCOM_CLIENT_SECRET` to `.env`.
4. For Calendly: register at `developer.calendly.com`, add `CALENDLY_CLIENT_ID/SECRET`.

### Timezone handling
`list_calendar_slots` returns UTC timestamps. The AI formats them in the
customer's local timezone using the contact session's `locale` field (add this
field to `ContactSession` when implementing; fall back to UTC with a note).

### Implementation notes (as shipped — verified 2026-06-29)

The shipped Cal.com adapter uses **API-key auth** (not OAuth — Cal.com requires a
company email to register an OAuth app; personal API keys at
`app.cal.com/settings/developer/api-keys` work without one). The verified working
v2 contract:

| Tool | Endpoint | `cal-api-version` | Notes |
|---|---|---|---|
| `list_event_types` | `GET /v2/event-types` | `2024-06-14` | **Required first** — discovers `eventTypeId`. Other version stamps 404 this path. |
| `list_calendar_slots` | `GET /v2/slots?eventTypeId&start&end&timeZone` | `2024-09-04` | `start`/`end` are ISO-8601 datetimes. Response is `{ data: { "YYYY-MM-DD": [{ start }] } }`. |
| `book_meeting` | `POST /v2/bookings` | `2024-08-13` | Body: `{ start, eventTypeId:<number>, attendee:{ name, email, timeZone, language } }`. |

All calls throw on non-2xx / `status:"error"` so failures aren't logged as success.
The AI is driven by `CALCOM_TOOL_INSTRUCTIONS` in `prompts.ts` (discover types →
list slots → collect name/email → book → confirm).

---

## 2B.2 — Subscription management (Paddle)

### Tools exposed
| Tool key | Description | Args |
|---|---|---|
| `get_subscription` | Look up customer's current plan | `{ customerEmail: string }` |
| `upgrade_subscription` | Upgrade to a higher plan | `{ customerEmail: string, targetPlanKey: string }` |
| `downgrade_subscription` | Downgrade to a lower plan | `{ customerEmail: string, targetPlanKey: string }` |
| `cancel_subscription` | Cancel subscription at period end | `{ customerEmail: string, reason?: string }` |

### Adapter — `apps/api/src/services/integrations/providers/paddle.ts`

Paddle is already integrated server-side (`billing.service.ts`). This adapter
**reuses the existing Paddle API client** — it wraps the same primitives rather
than duplicating HTTP calls.

```typescript
import { billingService } from "../billing.service";

export const PaddleAdapter: ProviderAdapter = {
  key: "paddle",
  displayName: "Paddle",
  authMode: "apikey",  // Org's Paddle API key (existing env var)
  getTools() { return [list_subscription_tools]; },
  async execute(toolKey, args, _credentials) {
    // Credentials ignored — use server-side env (already configured per org or per env)
    switch (toolKey) {
      case "get_subscription":
        return billingService.getSubscriptionByEmail(args.customerEmail);
      case "upgrade_subscription":
        return billingService.changeSubscriptionPlan(args.customerEmail, args.targetPlanKey, "upgrade");
      case "downgrade_subscription":
        return billingService.changeSubscriptionPlan(args.customerEmail, args.targetPlanKey, "downgrade");
      case "cancel_subscription":
        return billingService.cancelSubscription(args.customerEmail, args.reason);
    }
  },
};
```

### Guardrails
```json
{
  "requireBillingOwner": true
}
```

> **Changelog 5:** the `planDirection` / `upgradeOnly` ("block downgrades") guardrail
> was **removed** as redundant. Downgrades are a legitimate self-service action, and
> `requireBillingOwner` already controls *who* may change a plan. Keeping the flag only
> produced a confusing "I can't downgrade" refusal.

`requireBillingOwner`: before executing, compare `contactSession.email` with the
Paddle subscription's billing email. If they don't match → guardrail blocks.

**Identity verification**: OTP via email is required before executing
`upgrade_subscription`, `downgrade_subscription`, and `cancel_subscription`
(decided — see spec 30 § 2A.6 and BLOCKERS.md B-6). `get_subscription` is
read-only and does not require OTP.

### No new credentials required
Uses existing `PADDLE_API_KEY` and `PADDLE_ENVIRONMENT`. The Paddle connection in
the Integrations tab is pre-populated on first load for any org that already has
a Paddle subscription.

---

## 2B.3 — Refund (Stripe + Paddle)

### Tools exposed
| Tool key | Description | Args |
|---|---|---|
| `lookup_order` | Find order by ID or email | `{ orderId?: string, customerEmail?: string }` |
| `issue_refund` | Issue a full or partial refund | `{ orderId: string, amount?: number, reason: string }` |

### Stripe adapter — `apps/api/src/services/integrations/providers/stripe.ts`

```typescript
import Stripe from "stripe";

export const StripeAdapter: ProviderAdapter = {
  key: "stripe",
  authMode: "oauth",                  // Stripe Connect
  async execute(toolKey, args, credentials) {
    const { accessToken } = JSON.parse(credentials);   // connected account's access token
    const stripe = new Stripe(accessToken);

    if (toolKey === "lookup_order") {
      const charges = await stripe.charges.list({ customer: args.customerId, limit: 5 });
      return charges.data;
    }
    if (toolKey === "issue_refund") {
      return stripe.refunds.create({
        charge: args.orderId,
        amount: args.amount,                            // in cents; undefined = full refund
        reason: "customer_request",
        metadata: { csb_reason: args.reason },
      });
    }
  },
};
```

### Guardrails
```json
{
  "maxAmount": 10000,              // $100 max refund in cents
  "maxDaysSincePurchase": 30,
  "requireOrderOwnership": true    // email must match charge customer
}
```

### Blocker — Stripe Connect
Stripe Connect platform approval is required to obtain per-merchant OAuth tokens.
This is a **platform-level setup** (done by the SaaS operator, not the end-user
org). Steps:

> **User action required (Stripe Connect platform onboarding):**
> 1. Go to `dashboard.stripe.com → Settings → Connect`.
> 2. Fill out the platform profile (business type, website, use case description).
> 3. Submit for review. Stripe approval takes 1–5 business days.
> 4. Once approved, obtain `STRIPE_CLIENT_ID` (platform client ID).
> 5. Set `STRIPE_SECRET_KEY` (platform's own secret key, not a connected account).
> 6. Start this process immediately — it blocks the refund tool for weeks if delayed.

Until approved, the Stripe connector is hidden from the Integrations tab
(controlled by `STRIPE_CLIENT_ID` being unset).

### Fraud surface
Refunds are high-risk. Additional safeguards beyond guardrails:
- Only allow `issue_refund` after `lookup_order` verifies the order belongs to
  the customer (email match on `charge.customer.email`).
- Log every refund attempt in `ToolCallLog` even when guardrail-blocked.
- Start with `maxAmount: 5000` ($50) and `sandbox: true` until proven in
  production.

---

## 2B.4 — Order / shipping lookup (generic webhook)

### Design

This is the simplest tool: a **custom webhook connector** (spec 30, 2A.4) where
the operator pastes their order-management system's API endpoint.

No platform-level integration code is needed — the operator configures it in the
Integrations tab under "Custom webhook". They provide:
- Endpoint: `https://api.theirshop.com/orders/lookup`
- Auth header: `Authorization: Bearer <their-api-key>`
- Input schema:
  ```json
  {
    "type": "object",
    "properties": {
      "orderId": { "type": "string", "description": "The order ID" },
      "customerEmail": { "type": "string", "description": "Customer email" }
    },
    "required": []
  }
  ```
- Output schema (for validation):
  ```json
  {
    "type": "object",
    "properties": {
      "orderId": { "type": "string" },
      "status": { "type": "string" },
      "trackingNumber": { "type": "string" },
      "estimatedDelivery": { "type": "string" }
    }
  }
  ```

The AI calls `webhook_<connectionId>` (or the operator assigns a display name like
`track_order`). The webhook connector POSTs the args, returns the result.

### Blocker
SSRF protections (spec 30 § 2A.4) must be complete before this ships.

---

## 2B.5 — Ticket creation (Linear / Jira / Plain)

### Tools exposed
| Tool key | Description | Args |
|---|---|---|
| `create_support_ticket` | File a structured ticket with the conversation transcript | `{ title: string, priority?: "low"\|"medium"\|"high", tags?: string[] }` |

### Linear adapter — `apps/api/src/services/integrations/providers/linear.ts`

```typescript
import { LinearClient } from "@linear/sdk";

export const LinearAdapter: ProviderAdapter = {
  key: "linear",
  displayName: "Linear",
  authMode: "oauth",
  oauthConfig: {
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl:     "https://linear.app/oauth/token",
    scopes:       ["issues:create", "issues:read"],
    clientIdEnv:  "LINEAR_CLIENT_ID",
    clientSecretEnv: "LINEAR_CLIENT_SECRET",
  },
  async execute(toolKey, args, credentials) {
    const { accessToken } = JSON.parse(credentials);
    const client = new LinearClient({ accessToken });

    if (toolKey === "create_support_ticket") {
      // Get the operator-configured team from ToolDefinition guardrails.teamId
      const issue = await client.createIssue({
        teamId:      args._teamId,          // from guardrails config
        title:       args.title,
        description: args._transcript,      // injected by dispatcher
        priority:    mapPriority(args.priority),
        labelIds:    resolveLabelIds(args.tags, args._teamId, client),
      });
      return { issueId: issue.id, issueUrl: issue.url, issueIdentifier: issue.identifier };
    }
  },
};
```

### Dispatcher enhancement
When `create_support_ticket` is called, the dispatcher automatically appends the
conversation transcript to the args:

```typescript
if (toolDef.key === "create_support_ticket") {
  const messages = await Message.find({ conversationId }).sort({ createdAt: 1 }).lean();
  args._transcript = messages.map(m => `[${m.role}] ${m.content}`).join("\n");
  args._teamId = toolDef.guardrails.teamId;  // Linear team ID set by operator
}
```

### Guardrails / config
```json
{
  "teamId": "TEAM_ID_FROM_LINEAR",
  "defaultPriority": "medium"
}
```
Operator sets `teamId` when configuring the connector (it's a required field in
the connector setup form).

### Jira adapter
Uses Atlassian REST API with OAuth 2.0 (3LO). Create an issue via
`POST /rest/api/3/issue`. Same pattern as Linear.

**Implementation notes (as shipped — verified 2026-06-29):**
- OAuth scopes: `read:jira-user read:jira-work write:jira-work offline_access`.
  `read:jira-work` is required for project resolution; `offline_access` for refresh
  tokens. Connections created before `read:jira-work` was added must be reconnected.
- The OAuth callback resolves the Atlassian `cloudId` via
  `GET /oauth/token/accessible-resources` and stores it in `credentials.extra.cloudId`;
  all API calls go through `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3`.
- **Project auto-resolution:** the AI defaults `projectKey` to `"SUPPORT"`, which may
  not exist. `execute()` lists projects (`GET /project/search`), matches the requested
  key case-insensitively, and falls back to the first available project. Falls through
  to the requested key if the scope is missing.
- `execute()` throws on non-2xx (surfacing Jira's `errorMessages`/`errors`) so a
  failed call is logged `status:"error"` and never reported to the customer as success.
- Returns `{ ok, key, id, url, project }`.

> **User action required (per provider):**
> 1. **Linear**: Go to `linear.app/settings/api` → OAuth applications → Create.
>    Add `{API_BASE_URL}/api/v1/integrations/linear/callback` as redirect URI.
>    Add `LINEAR_CLIENT_ID/SECRET` to `.env`.
> 2. **Jira/Atlassian**: Go to `developer.atlassian.com` → Create app → OAuth 2.0.
>    Add `{API_BASE_URL}/api/v1/integrations/jira/callback` as redirect URI.
>    Add `ATLASSIAN_CLIENT_ID/SECRET` to `.env`.

### When the AI uses it
The system prompt (Layer 5) includes:
```
### create_support_ticket
Use this tool when you cannot resolve the customer's issue and they agree to
file a support ticket. Prefer escalation to a human operator for urgent issues;
prefer ticket creation for non-urgent, async-friendly issues.
```

---

## 2B.6 — Knowledge-gap auto-tool

### Problem
The AI answers questions even when KB coverage is weak. There is no mechanism to
identify which questions the KB fails to answer.

### Design

This is an **internal tool** — no external provider, no connector, no credentials.
It is always available to the AI via a built-in tool (not a `ToolDefinition` record).

**New model — `apps/api/src/models/KnowledgeGap.ts`**
```typescript
{
  organizationId:  { type: ObjectId, ref: "Organization", required: true },
  agentId:         { type: ObjectId, ref: "Agent", required: true },
  question:        { type: String, required: true },        // customer's verbatim question
  queryUsed:       { type: String },                        // search query the AI used
  maxKbScore:      { type: Number },                        // highest Pinecone similarity score
  occurrenceCount: { type: Number, default: 1 },            // incremented on duplicate questions
  status:          { type: String, enum: ["open", "addressed"], default: "open" },
  createdAt:       { type: Date, default: Date.now },
  updatedAt:       { type: Date, default: Date.now },
}
// Indexes: { organizationId:1, status:1, occurrenceCount:-1 }, { organizationId:1, question:1 } (for dedup)
```

**Logging** (inside `generateAiReply()`):

After each `search_kb` call, evaluate:
```typescript
const MAX_SCORE_THRESHOLD = 0.65;  // below this = likely a gap
if (maxScore < MAX_SCORE_THRESHOLD) {
  await KnowledgeGap.findOneAndUpdate(
    { organizationId, agentId, question: customerMessage },
    {
      $setOnInsert: { organizationId, agentId, question: customerMessage, queryUsed, maxKbScore: maxScore },
      $inc: { occurrenceCount: 1 },
      $set:  { updatedAt: new Date() },
    },
    { upsert: true }
  );
}
```

**Dashboard analytics card**

New card in `apps/web/src/app/(dashboard)/app/analytics`:

```
🕳 Knowledge Gaps (this week)
─────────────────────────────
  12 questions had no good answer
  Top gaps:
  • "How do I export my data?"  — asked 7× [Add to KB]
  • "What's the API rate limit?" — asked 5× [Add to KB]
  • "Cancel vs pause?"          — asked 4× [Add to KB]
  [View all]
```

"Add to KB" links to `?prefill=<question>` on the `/app/knowledge` page.

### No credentials required
Fully internal. The `MAX_SCORE_THRESHOLD` is configurable as env var
`AI_KB_GAP_SCORE_THRESHOLD` (default: 0.65).

---

## Files summary

| File | Change |
|---|---|
| `apps/api/src/services/integrations/providers/calcom.ts` | New adapter |
| `apps/api/src/services/integrations/providers/calendly.ts` | New adapter |
| `apps/api/src/services/integrations/providers/paddle.ts` | New adapter (wraps billing.service.ts) |
| `apps/api/src/services/integrations/providers/stripe.ts` | New adapter |
| `apps/api/src/services/integrations/providers/linear.ts` | New adapter |
| `apps/api/src/services/integrations/providers/jira.ts` | New adapter |
| `apps/api/src/models/KnowledgeGap.ts` | New model |
| `apps/api/src/services/ai/agent.service.ts` | Knowledge-gap logging, transcript injection |
| `apps/api/src/services/ai/prompts.ts` | Tool instructions for ticket creation |
| `apps/web/src/app/(dashboard)/app/analytics` | Knowledge-gap analytics card |

## New env vars (add to `.env.example`)
All OAuth client IDs/secrets listed in spec 30 § 2A.3 table. Additions here:

| Variable | Description |
|---|---|
| `AI_KB_GAP_SCORE_THRESHOLD` | Min Pinecone score to avoid logging a gap (default: `0.65`) |

## Acceptance

- [ ] Cal.com: AI calls `list_calendar_slots` → displays slots (markdown list or card) → customer picks one → AI calls `book_meeting` → event appears in operator's calendar.
- [ ] Paddle: AI calls `get_subscription` → reports customer's current plan; calls `upgrade_subscription` → Paddle subscription updated.
- [ ] Stripe (sandbox): AI calls `issue_refund` within guardrail caps → Stripe test refund created.
- [ ] Stripe: refund exceeding `maxAmount` → guardrail blocks → AI explains to customer.
- [ ] Webhook: operator configures a test endpoint → AI calls it → response returned.
- [ ] Linear: AI calls `create_support_ticket` → issue appears in Linear with the full transcript.
- [ ] Low-KB-score conversation → `KnowledgeGap` document created / `occurrenceCount` incremented.
- [ ] Analytics page shows knowledge-gap list, sorted by frequency, with "Add to KB" links.
