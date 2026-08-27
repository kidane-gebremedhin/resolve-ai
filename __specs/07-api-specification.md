# 07 — API Specification

## Base Configuration

| Setting | Value |
|---------|-------|
| Base URL | `http://localhost:4000/api/v1` (dev) |
| Content-Type | `application/json` |
| Auth header | `Authorization: Bearer <JWT>` |
| Rate limit (dashboard) | 100 req/min per user |
| Rate limit (widget) | 30 req/min per session |

---

## Authentication Routes

### `POST /api/v1/auth/register`
Create a new user account (email/password).

| Field | Value |
|-------|-------|
| Auth | None |
| Body | `{ email, password, name }` |
| Validation | email: valid email; password: min 8 chars, 1 upper, 1 number; name: 2–100 chars |
| Response `201` | `{ user: { id, email, name }, token }` |
| Errors | `400` validation, `409` email exists |
| Side effects | Creates user + organization + membership (owner) |

### `POST /api/v1/auth/login`
Authenticate with email/password.

| Field | Value |
|-------|-------|
| Auth | None |
| Body | `{ email, password }` |
| Response `200` | `{ user: { id, email, name, organizationId }, token, expiresAt }` |
| Errors | `400` validation, `401` invalid credentials |

### `POST /api/v1/auth/google`
Authenticate with Google OAuth token (from NextAuth callback).

| Field | Value |
|-------|-------|
| Auth | None |
| Body | `{ googleToken, name, email, avatarUrl }` |
| Response `200` | `{ user, token, isNewUser }` |
| Side effects | Creates user + org if new |

### `POST /api/v1/auth/forgot-password` (Changelog 9)
Request a password reset. Always returns a generic `200 { ok, message }` — never reveals
whether the email is registered. For a credentials account it emails a 1-hour reset link
(`${WEB_BASE_URL}/reset-password?token=…`); only a SHA-256 **hash** of the token is stored
on the user. Body `{ email }`.

### `POST /api/v1/auth/reset-password` (Changelog 9)
Set a new password with a valid, unexpired token. Body `{ token, password }`. `200 { ok }`
on success; `401` if the token is invalid/expired. Clears the reset token on success.

### `POST /api/v1/auth/refresh`
Exchange a (7d) refresh token for a fresh (15m) access token.

| Field | Value |
|-------|-------|
| Auth | None (refresh token in body) |
| Body | `{ refreshToken }` |
| Response `200` | `{ accessToken, expiresIn }` (`expiresIn` in seconds, 900) |
| Errors | `401` missing/expired/invalid refresh token |

`POST /auth/login` and `POST /auth/google` both return `{ ..., accessToken, refreshToken, expiresIn }`.
The web dashboard's NextAuth `jwt` callback stores the refresh token and silently
rotates the access token ~1 min before expiry (see `apps/web/src/lib/auth.ts`), so
the 7d session no longer outlives the 15m access token. Only when the refresh
token itself expires does the session fall back to client auto-logout (§12, 2.9b).

---

## Organization Routes

### `GET /api/v1/orgs/current`
Get current user's active organization.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Response `200` | `{ organization: { id, name, slug, plan, settings } }` |

### `PATCH /api/v1/orgs/current`
Update organization settings.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin only) |
| Body | `{ name?, settings? }` |
| Response `200` | `{ organization }` |
| Errors | `403` insufficient role |

### `GET /api/v1/orgs/current/members`
List organization members.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Response `200` | `{ members: [{ userId, name, email, role, status }] }` |

### `POST /api/v1/orgs/current/members/invite`
Invite a user to the organization.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Body | `{ email, role }` |
| Response `201` | `{ membership }` |
| Side effects | Send invitation email via Nodemailer |
| Errors | `409` already a member |

### `PATCH /api/v1/orgs/current/members/:userId`
Update member role or status.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Body | `{ role?, status? }` |
| Response `200` | `{ membership }` |

### `DELETE /api/v1/orgs/current/members/:userId`
Remove a member from the organization.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner only) |
| Response `204` | No content |
| Errors | `403` cannot remove self if sole owner |

---

## Website Routes

### `GET /api/v1/websites`
List websites for current organization.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Response `200` | `{ websites: [{ id, name, domain, allowedOrigins, isActive }] }` |
| RLS | `organizationId` from JWT |

### `POST /api/v1/websites`
Create a new website.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Body | `{ name, domain, allowedOrigins }` |
| Response `201` | `{ website }` |
| Errors | `409` domain already exists for this org |

### `PATCH /api/v1/websites/:websiteId`
Update website settings.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Body | `{ name?, domain?, allowedOrigins?, isActive? }` |
| Response `200` | `{ website }` |

### `DELETE /api/v1/websites/:websiteId`
Delete a website and its associated conversations.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner only) |
| Response `204` | No content |
| Side effects | Cascade: deactivate widget, archive conversations |

---

## Agent Routes

### `GET /api/v1/agents`
List agents for current organization.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Response `200` | `{ agents: [Agent] }` |

### `POST /api/v1/agents`
Create a new agent.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Body | `{ name, description?, welcomeMessage?, suggestedQuestions?, systemPromptOverride?, model?, temperature?, confidenceThreshold? }` |
| Response `201` | `{ agent }` |

### `PATCH /api/v1/agents/:agentId`
Update agent configuration.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Body | Partial agent fields |
| Response `200` | `{ agent }` |

### `DELETE /api/v1/agents/:agentId`
Delete an agent.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner only) |
| Response `204` | No content |

---

## Conversation Routes (Dashboard — Private)

### `GET /api/v1/conversations`
List conversations for inbox.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Query | `?status=active,escalated&websiteId=xxx&assignedTo=me&page=1&limit=20&sort=lastMessageAt` |
| Response `200` | `{ conversations: [{ id, threadId, status, lastMessageAt, lastMessagePreview, contact: { name, email }, messageCount }], pagination }` |
| RLS | `organizationId` from JWT; optional `websiteId` filter |

### `GET /api/v1/conversations/:conversationId`
Get conversation detail with contact info.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Response `200` | `{ conversation, contact: { name, email, phone }, website: { name, domain } }` |

### `PATCH /api/v1/conversations/:conversationId/status`
Update conversation status (resolve/reopen/escalate).

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Body | `{ status: 'resolved' | 'active' | 'escalated', assignedOperatorId? }` |
| Response `200` | `{ conversation }` |
| Side effects | Socket.io emit `conversation:status`; system message |

### `PATCH /api/v1/conversations/:conversationId/assign`
Assign conversation to an operator.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Body | `{ operatorId }` |
| Response `200` | `{ conversation }` |

---

## Message Routes (Dashboard — Private)

### `GET /api/v1/conversations/:conversationId/messages`
Get messages in a conversation thread.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Query | `?page=1&limit=50&before=<timestamp>` |
| Response `200` | `{ messages: [Message], pagination }` |
| RLS | Conversation must belong to operator's org |

### `POST /api/v1/conversations/:conversationId/messages`
Send an operator message.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Body | `{ content, attachments?, isEnhanced?, originalContent? }` |
| Response `201` | `{ message }` |
| Side effects | Socket.io emit `message:new` to conversation room; update `lastMessageAt` |

### `POST /api/v1/messages/enhance`
Enhance operator draft message (see [§06](./06-operator-enhancement-llm.md)).

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Body | `{ conversationId, draftText, tone? }` |
| Response `200` | `{ enhancedText, originalText, changes }` |

> **Operator send** is actually `POST /api/v1/messages` with body `{ conversationId, content, role?, attachments?, isEnhanced?, originalContent? }` (router mounted at `/messages`). `content` may be empty when `attachments[]` is present (the file names become the content/preview).

### `POST /api/v1/messages/attachments`
Operator attachment upload (mirror of the widget upload, operator JWT). _(Changelog 18.)_

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Body | `multipart/form-data`: `file`, `conversationId` |
| Response `201` | `{ attachment: { url, fileUrl, fileName, mimeType, size, extractedText? } }` |
| Notes | `url`/`fileUrl` → `${API_BASE_URL}/api/v1/messages/attachments/{sha}`; tenant-scoped storage key shared with widget uploads |

### `GET /api/v1/messages/attachments/:hash`
Streams a stored attachment for the operator's org (any org+sha — serves both operator- and widget-uploaded files). _(Changelog 18.)_

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Response `200` | file stream; `Cross-Origin-Resource-Policy: cross-origin` |
| Notes | The dashboard loads these via the web app's same-origin proxy `GET /api/attachments/[hash]` (forwards with the bearer), so no token appears in URLs |

---

## Knowledge Base Routes (Dashboard — Private)

### `GET /api/v1/knowledge`
List KB sources.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Query | `?type=pdf,text&status=synced&page=1&limit=20` |
| Response `200` | `{ sources: [KnowledgeSource], pagination }` |
| RLS | `organizationId` from JWT |

### `POST /api/v1/knowledge`
Create a KB source (text).

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Body | `{ title, content, type: 'text' }` |
| Response `201` | `{ source }` |
| Side effects | Compute contentHash → dedup check → chunk → embed → Pinecone |
| Errors | `409` duplicate contentHash |

### `POST /api/v1/knowledge/upload`
Upload a file (PDF, DOCX, Excel, CSV, Image, HTML).

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Body | `multipart/form-data` with `file` + `title` |
| Allowed MIME | `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/csv`, `image/png`, `image/jpeg`, `image/webp`, `text/html` |
| Max size | Plan-dependent (5–50 MB) |
| Response `201` | `{ source }` (embeddingStatus: 'pending') |
| Side effects | Extract text → hash → dedup → async embed |

### `POST /api/v1/knowledge/website`
Ingest a website via Firecrawl.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Body | `{ url, title?, maxPages? }` |
| Response `202` | `{ jobId, source }` (processing async) |
| Side effects | Firecrawl crawl → per-page chunk → embed |

### `GET /api/v1/knowledge/:sourceId`
Get KB source detail.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Response `200` | `{ source, chunks?: [...] }` |

### `PUT /api/v1/knowledge/:sourceId`
Update KB source content.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Body | `{ title?, content? }` or `multipart/form-data` for file replacement |
| Response `200` | `{ source }` |
| Side effects | Re-hash → delete old vectors → re-chunk → re-embed |

### `DELETE /api/v1/knowledge/:sourceId`
Delete KB source and its Pinecone vectors.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Response `204` | No content |
| Side effects | Delete Pinecone vectors (`pineconeIds`) → delete file from storage → delete MongoDB record |

---

## Public Platform Routes

Unauthenticated, non-sensitive endpoints under `/api/v1/public` (see
`apps/api/src/routes/public.routes.ts`).

### `GET /api/v1/public/demo-agent`
Returns `{ agentId }` — the most-recently-created active agent, for the marketing
site's embedded widget. Cached 60 s.

### `GET /api/v1/public/theming`
Returns `{ fontSans, fontDisplay }` for the web root layout. Cached 60 s.

### `POST /api/v1/public/contact`
Public marketing "Contact Us" submission (Changelog 2).

| Field | Value |
|-------|-------|
| Auth | None (public) |
| Rate limit | 5 / hour / IP (`429` on exceed) |
| Body | `{ name: string(1..120), email: email, message: string(1..5000) }` |
| Behaviour | Persists a `ContactMessage`; best-effort emails `CONTACT_INBOX_EMAIL` (never blocks the response) |
| Response `201` | `{ ok: true, id }` |
| Response `400` | Validation error |

---

## Widget Routes (Public)

### `POST /api/v1/widget/sessions`
Create or resume a contact session.

| Field | Value |
|-------|-------|
| Auth | None (public) |
| Body | `{ organizationId, agentId, websiteId, token?, email?, phone? }` |
| Response `200` (resume) | `{ session, conversations: [...] }` |
| Response `201` (new) | `{ session: { id, token } }` |
| Logic | If `token` provided and valid (not expired) → resume; else → create new. If `email` provided, store on session at creation. |
| CORS | Validate request origin against `website.allowedOrigins` |

### `POST /api/v1/widget/sessions/:sessionId/contact`
Update contact info on an existing session. **Note:** This endpoint is now secondary — primary contact collection happens at session creation. This endpoint remains available for updating contact info later (e.g., adding phone after initial email-only submission).

| Field | Value |
|-------|-------|
| Auth | Session token header (`X-Session-Token`) |
| Body | `{ email?, phone?, name? }` |
| Response `200` | `{ session }` |
| Note | Email and phone are primarily collected at session creation (pre-chat form). This endpoint is for updates only. |

### `POST /api/v1/widget/conversations`
Start a new conversation.

| Field | Value |
|-------|-------|
| Auth | Session token (`X-Session-Token`) |
| Body | `{ agentId, websiteId, initialMessage }` |
| Response `201` | `{ conversation, message: { id, content, role: 'customer' } }` |
| Side effects | Save customer message → trigger AI agent → emit Socket.io |

### `GET /api/v1/widget/conversations/:conversationId/messages`
Get messages for a widget conversation.

| Field | Value |
|-------|-------|
| Auth | Session token (`X-Session-Token`) |
| Query | `?before=<timestamp>&limit=30` |
| Response `200` | `{ messages: [{ id, role, content, attachments, createdAt }] }` |
| RLS | Conversation must belong to the session's `contactSessionId` |

### `POST /api/v1/widget/conversations/:conversationId/messages`
Send a customer message.

| Field | Value |
|-------|-------|
| Auth | Session token (`X-Session-Token`) |
| Body | `{ content, attachments? }` |
| Response `201` | `{ message }` |
| Side effects | Save message → trigger AI agent (if status = active) → emit Socket.io |

### `POST /api/v1/widget/conversations/:conversationId/attachments`
Upload a file attachment in widget.

| Field | Value |
|-------|-------|
| Auth | Session token (`X-Session-Token`) |
| Body | `multipart/form-data` with `file` |
| Max size | 10 MB |
| Allowed MIME | `image/*`, `application/pdf`, `text/plain` |
| Response `201` | `{ attachment: { fileName, fileUrl, mimeType, size } }` |

### `GET /api/v1/widget/settings`
Get widget display settings (for rendering the widget UI).

| Field | Value |
|-------|-------|
| Auth | None (public) |
| Query | `?organizationId=xxx&agentId=xxx` |
| Response `200` | `{ settings: WidgetSettings, agent: { name, avatarUrl }, sections: [...] }` |

---

## Billing Routes (Paddle Webhooks)

### `POST /api/v1/billing/paddle/webhook`
Paddle webhook receiver.

| Field | Value |
|-------|-------|
| Auth | Paddle signature verification |
| Events handled | **subscription.\*** → entitlement (`subscription.created/updated/canceled/past_due/…`)<br>**transaction.\*** → payment ledger (`transaction.billed/paid/completed/payment_failed/past_due/updated`)<br>**adjustment.\*** → refunds and chargebacks (`adjustment.created/updated`) |
| Response `204` | No content |
| Idempotency | `ProcessedWebhook` (`eventId` unique) is claimed **before** the event family is inspected, so it is consumed exactly once per event id no matter which handler runs |
| Side effects | Updates `subscriptions`, `organizations.plan` (subscription events only), and `payments` (transaction and adjustment events only) |

> Refunds and chargebacks are **not** `transaction.*` events in Paddle Billing.
> They arrive as `adjustment.created` / `adjustment.updated` with an `action` of
> `refund`, `chargeback`, `chargeback_reverse` or `chargeback_warning`, and are
> applied only when the adjustment's own `status` is `approved`.

### `GET /api/v1/billing/subscription`
Get current org subscription status.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Response `200` | `{ subscription, plan, usage: { aiMessages, kbSources } }` |

### `GET /api/v1/billing/payments`
Billing history: one row per payment attempt at the provider, newest first.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Query | `limit` (default 50, max 200) |
| Response `200` | `{ payments: [{ id, status, amount, currency, tax, description, occurredAt, invoiceUrl, receiptUrl, failureReason, paymentMethod: { type, last4, brand } }] }` |
| Notes | `amount` and `tax` are in **minor units** (cents), as the provider reports them. Read-only: the ledger is written only by the webhook path |

### `GET /api/v1/billing/payments/:id/invoice`
Mint a customer-facing invoice PDF link for one payment.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Response `200` | `{ url }` |
| Errors | `400 no_invoice` when the payment never billed (failed or pending); `404` when the payment does not belong to the caller's org; `502 paddle_unavailable` |
| Notes | The URL is minted per request and **expires after an hour**, so it is never stored on the payment row. `hasInvoice` on the list response says whether a row can produce one |

### `GET /api/v1/billing/payments/latest`
The most recent payment attempt for the org.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (any org member) |
| Response `200` | `{ payment: PaymentRow \| null }` |
| Purpose | The checkout pending page polls this alongside `/billing/subscription`, so a declined card surfaces as `failed` immediately instead of spinning until the poll gives up |

### `POST /api/v1/billing/checkout`
Generate a Paddle checkout link.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Body | `{ plan: 'starter' | 'pro' | 'enterprise' }` |
| Response `200` | `{ checkoutUrl }` |

### `POST /api/v1/billing/portal`
Generate a Paddle customer portal link.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Response `200` | `{ portalUrl }` |

---

## Admin Routes (Platform Admin)

### `GET /api/v1/admin/organizations`
List all organizations (platform admin only).

| Field | Value |
|-------|-------|
| Auth | Bearer JWT + `role: platform_admin` |
| Query | `?page=1&limit=20&search=xxx` |
| Response `200` | `{ organizations: [...], pagination }` |

### `GET /api/v1/admin/stats`
Platform-wide statistics.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT + `role: platform_admin` |
| Response `200` | `{ totalOrgs, totalUsers, totalConversations, activeConversations, totalMessages }` |

---

## Leads Routes (Dashboard)

### `GET /api/v1/leads`
List contact sessions with contact info (leads view).

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Query | `?websiteId=xxx&hasEmail=true&page=1&limit=20` |
| Response `200` | `{ leads: [{ sessionId, name, email, phone, conversationCount, lastActiveAt }], pagination }` |
| RLS | `organizationId` from JWT |

---

## Widget Settings Routes (Dashboard)

### `GET /api/v1/widget-settings/:agentId`
Get widget settings for an agent.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Response `200` | `{ settings: WidgetSettings }` |

### `PUT /api/v1/widget-settings/:agentId`
Update widget settings.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Body | Full or partial `WidgetSettings` |
| Response `200` | `{ settings }` |

---

## Sections Routes (Dashboard)

### `GET /api/v1/sections/:agentId`
List widget sections for an agent.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Response `200` | `{ sections: [Section] }` |

### `POST /api/v1/sections/:agentId`
Create a section.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Body | `{ title, description?, icon?, url?, action, topicPrompt?, order }` |
| Response `201` | `{ section }` |

### `PUT /api/v1/sections/:agentId/reorder`
Reorder sections.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Body | `{ sectionIds: [ordered array of section IDs] }` |
| Response `200` | `{ sections }` |

### `DELETE /api/v1/sections/:sectionId`
Delete a section.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT (owner/admin) |
| Response `204` | No content |

---

## Analytics Routes (Dashboard)

> **Corrected.** This section previously documented `GET /analytics/overview`
> and `GET /analytics/conversations`. **Neither exists**, neither has ever been
> implemented, and no client calls either — the dashboard is built from the
> endpoints below. They were left in the spec long enough to be referenced from
> four other spec files. A spec that names endpoints the code does not serve is
> worse than an incomplete one, because it is what a regeneration builds from.

### `GET /api/v1/analytics/volume` (Changelog 3)
Message + knowledge-source volume **scoped to the selected filters**, so the analytics
"Messages this period" / "Volume" cards obey the date range + website (billing `/usage`
is billing-period + org-wide and can't). Messages are counted in the window; when a
`websiteId` is given they're limited to that site's conversations and KB sources to that
site's agents.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Query | `?from=YYYY-MM-DD&to=YYYY-MM-DD` or `?days=N`, optional `&websiteId=xxx` |
| Response `200` | `{ messages, knowledgeSources, websiteScoped }` |

> `GET /api/v1/analytics/knowledge-gaps` also honours these filters now (Changelog 3):
> `?from&to|days` (window on `updatedAt`) and `?websiteId` (resolved to the website's
> agent ids, since gaps are keyed by agent).

### `GET /api/v1/analytics/conversations-daily`
Conversation counts per day, server-aggregated.

| Field | Value |
|-------|-------|
| Auth | Bearer JWT |
| Query | `?from&to` or `?days=N`, optional `&websiteId=` / `&agentId=` |
| Response `200` | `{ points: [{ date, total, resolved, aiResolved, escalated }], days }` |

### `GET /api/v1/analytics/csat-ratings`
Individual CSAT star ratings with comments, for the feedback detail view.

| Field | Value |
|-------|-------|
| Query | `?from&to` or `?days=N`, optional `&websiteId=`, `&limit=` (1-300, default 100) |
| Response `200` | `{ items: [{ _id, conversationId, stars, comment, createdAt }] }` |

### `GET /api/v1/analytics/low-rated-answers`
Most recent thumbs-down feedback, enriched with the message content.

| Field | Value |
|-------|-------|
| Query | `?from&to` or `?days=N`, optional `&websiteId=`, `&limit=` (1-200, default 50) |
| Response `200` | `{ items: [{ _id, messageId, conversationId, reason, createdAt, messageContent }] }` |

### `GET /api/v1/analytics/tool-calls`
Integration tool-call audit trail from `ToolCallLog`.

| Field | Value |
|-------|-------|
| Query | `?from&to` or `?days=N`, optional `&websiteId=` / `&agentId=` |
| Response `200` | `{ items: [...], summary: { total, byStatus } }` |

---

## RAG Metrics Routes (Dashboard — Private)

Read-only production RAG quality, backing the **RAG Quality** page
([`11-page-wiremap.md`](11-page-wiremap.md)) over the `RagTurnMetric` collection
from [`39-rag-evaluation.md`](39-rag-evaluation.md).

Shared across every route below:

| | |
|---|---|
| Auth | Bearer JWT, `requireAuth` + `requireOrg` |
| Scope | Organization is stamped from the token, **never** from the query string. `?agentId` / `?websiteId` can only NARROW that scope; an agent id belonging to another org is rejected before it reaches a `$match` |
| Query | `?from=YYYY-MM-DD&to=YYYY-MM-DD` or `?days=N` (1-365, default 30), optional `&agentId=` or `&websiteId=` |
| Aggregation | Server-side MongoDB pipelines only, every one index-backed. `rag-metrics.test.ts` runs the real endpoints under MongoDB's profiler and fails on a `COLLSCAN` |
| Nulls | A metric with no data is `null`, never `0`. The two are different facts and the UI renders them differently |

### `GET /api/v1/rag-metrics/summary`
Header KPIs with a period-over-period delta against the window of equal length
immediately before the selected one.

| Field | Value |
|-------|-------|
| Response `200` | `{ range, previousRange, current, previous, deltas }` |
| `current` / `previous` | `{ turns, faithfulness, faithfulnessSamples, meanConfidence, meanRetrievalConfidence, noHitRate, lowConfidenceRate, escalationRate, conflictRate, p50LatencyMs, p95LatencyMs, costPerConversation, totalCostUsd, pricedConversations }` |
| `deltas` | `{ faithfulness, meanConfidence, noHitRate, escalationRate, p95LatencyMs, costPerConversation }`, each in the metric's own units, or `null` when either period has no data |

Cost sums **priced turns only**, and the conversation denominator is built from
the same turns, so the ratio is a cost per *priced* conversation. A turn
OpenRouter never resolved is unknown, not free.

### `GET /api/v1/rag-metrics/retrieval`
Recall@K, Precision@K and MRR at K = 3, 5, 10, plus the score histogram.

| Field | Value |
|-------|-------|
| Response `200` | `{ minScoreThreshold, bucketWidth, ks, scoredTurns, totalTurns, recallAtK, precisionAtK, mrr, meanTopScore, noHitRate, widenOnEmptyRate, p50LatencyMs, p95LatencyMs, distribution }` |
| `distribution` | `[{ from, to, count }]`, 20 buckets of 0.05 over `retrieval.topScore`, bucketed by `$bucket` |
| `minScoreThreshold` | The live `AI_KB_SEARCH_MIN_SCORE`, so the page draws its threshold line from running config rather than a hardcoded copy |

Scored against the sources the reply cited, standing in for the offline
harness's declared relevant set. Turns that cited nothing are excluded from
`scoredTurns`, never counted as zero.

### `GET /api/v1/rag-metrics/generation`
Confidence and sampled faithfulness over time, grounding rates, thumbs, and
unsupported-claim examples.

| Field | Value |
|-------|-------|
| Query | plus `?examples=N` (1-50, default 10) |
| Response `200` | `{ meanConfidence, faithfulness, faithfulnessSamples, escalationRate, citationRate, citationsPerAnswer, thumbs, daily, unsupportedExamples }` |
| `thumbs` | `{ up, down, total, helpfulness }` from `MessageFeedback` |
| `daily` | `[{ date, turns, confidence, faithfulness, faithfulnessSamples }]`, faithfulness `null` on days nothing was sampled |
| `unsupportedExamples` | `[{ conversationId, messageId, query, score, createdAt, claims: [{ claim, verdict, reason }] }]` |

### `GET /api/v1/rag-metrics/cost`
Tokens, USD and end-to-end latency over time.

| Field | Value |
|-------|-------|
| Response `200` | `{ totals: { turns, pricedTurns, promptTokens, completionTokens, costUsd, pricedShare, costPerTurn }, daily: [{ date, turns, pricedTurns, promptTokens, completionTokens, costUsd, p50LatencyMs, p95LatencyMs }] }` |

`pricedShare` is reported so a suspiciously low total can be told apart from a
window OpenRouter never resolved.

### `GET /api/v1/rag-metrics/failing-queries`
Highest-volume queries that found nothing or answered with low confidence.

| Field | Value |
|-------|-------|
| Query | plus `?limit=N` (1-100, default 20) |
| Response `200` | `{ items: [{ query, turns, noHits, lowConfidence, meanConfidence, meanTopScore, lastSeen, conversationId, gap }] }` |
| `gap` | The matching `KnowledgeGap`, or `null` |

The gap join runs in the API rather than as a `$lookup`: `originalQuery` is
masked before it is persisted and `KnowledgeGap.queryUsed` is not, so joining on
raw text would silently miss every query containing an email address or a card
number. The gap side is masked here so the join is exact for those too.

### `GET /api/v1/rag-metrics/source-health`
Per-source retrieval, dead weight, and ingestion failures.

| Field | Value |
|-------|-------|
| Query | plus `?limit=N` (1-200, default 50) |
| Response `200` | `{ top, neverRetrieved, totals, ingestion }` |
| `top` | `[{ sourceId, title, type, embeddingStatus, retrievalCount, topRankCount, meanTopScore, lastRetrieved }]` |
| `neverRetrieved` | Sources with `embeddingStatus: "synced"` that no turn in the window retrieved |
| `ingestion` | P8's `ingestionHealth` — a source that never indexed cannot be retrieved, and looks identical to dead weight on a relevance panel alone |

`meanTopScore` averages only the turns where the source ranked **first**. The
turn's top score belongs to the top-ranked source, so crediting every source in
a turn with it would be wrong; excluding them is exact.

### `GET /api/v1/rag-metrics/eval-runs`
The last offline harness reports, read from `RAG_EVAL_REPORTS_DIR`.

| Field | Value |
|-------|-------|
| Query | `?limit=N` (1-50, default 10) |
| Response `200` | `{ available, runs: [{ file, startedAt, finishedAt, dataset, answeringModel, judgeModel, cases, errored, retrieval, generation, operational }] }` |

`available: false` with an empty list when the directory is absent, which is the
normal case for a deployment shipping only the API image. An unparseable report
is skipped, not fatal.

### `GET /api/v1/rag-metrics/definitions`
The plain-language definition behind every tile's tooltip.

| Field | Value |
|-------|-------|
| Response `200` | `{ definitions: { [key]: { label, definition, note?, example?, spec } } }` |

Served rather than duplicated in the web app so the page and the offline report
cannot drift. `rag-metrics.test.ts` parses the metric tables in
[`39-rag-evaluation.md`](39-rag-evaluation.md) and fails if a word differs.

---

## Common Response Patterns

### Pagination

```typescript
interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
```

### Error Response

```typescript
interface ErrorResponse {
  error: {
    code: string;           // Machine-readable code (e.g., 'DUPLICATE_CONTENT')
    message: string;        // Human-readable message
    details?: Record<string, unknown>;
  };
}
```

### Standard HTTP Status Codes

| Code | Usage |
|------|-------|
| `200` | Success (read/update) |
| `201` | Created |
| `202` | Accepted (async job started) |
| `204` | Deleted (no content) |
| `400` | Validation error |
| `401` | Unauthorized (no/invalid token) |
| `403` | Forbidden (insufficient role/org) |
| `404` | Not found |
| `409` | Conflict (duplicate) |
| `429` | Rate limited |
| `500` | Server error |
