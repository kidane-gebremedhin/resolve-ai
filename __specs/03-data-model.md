# 03 — Data Model (MongoDB)

## Overview

All collections enforce **`organizationId`** scoping. Every query from authenticated context must include `organizationId` — there is no global data access except for platform admin operations.

---

## Collections

### 1. `organizations`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `name` | `string` | ✅ | Organization display name |
| `slug` | `string` | ✅ | URL-friendly unique slug |
| `plan` | `string` | ✅ | `free` / `starter` / `pro` / `enterprise` |
| `paddleCustomerId` | `string` | — | Paddle customer ID |
| `paddleSubscriptionId` | `string` | — | Active subscription ID |
| `settings` | `object` | — | Org-level settings (timezone, language) |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ slug: 1 }` — unique
- `{ paddleCustomerId: 1 }` — unique, sparse

---

### 2. `users`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `email` | `string` | ✅ | Unique across platform |
| `passwordHash` | `string` | — | bcrypt hash (null for OAuth-only users) |
| `phone` | `string` | ✅ | phone |
| `avatarUrl` | `string` | — | Profile image URL |
| `provider` | `string` | ✅ | `credentials` / `google` |
| `providerId` | `string` | — | Google sub ID (for OAuth) |
| `role` | `string` | ✅ | `user` / `platform_admin` |
| `emailVerifiedAt` | `Date` | — | Email verification timestamp |
| `lastLoginAt` | `Date` | — | |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ email: 1 }` — unique
- `{ provider: 1, providerId: 1 }` — unique, sparse

---

### 3. `memberships`

Links users to organizations with role-based access.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `userId` | `ObjectId` | ✅ | Ref → `users` |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `role` | `string` | ✅ | `owner` / `admin` / `agent` / `viewer` |
| `invitedBy` | `ObjectId` | — | Ref → `users` |
| `invitedAt` | `Date` | — | |
| `acceptedAt` | `Date` | — | |
| `status` | `string` | ✅ | `active` / `pending` / `revoked` |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ userId: 1, organizationId: 1 }` — unique (one membership per user-org pair)
- `{ organizationId: 1, role: 1 }` — for listing org members by role
- `{ userId: 1, status: 1 }` — for user's active orgs

---

### 4. `websites`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `name` | `string` | ✅ | Display name (e.g., "Main Website") |
| `domain` | `string` | ✅ | `example.com` |
| `allowedOrigins` | `string[]` | ✅ | CORS origins for widget embed |
| `isActive` | `boolean` | ✅ | Whether widget is enabled |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ organizationId: 1 }` — list websites per org
- `{ organizationId: 1, domain: 1 }` — unique per org

---

### 5. `agents`

The agent record stores **configuration and branding per website** — one agent
per website (unique index on `websiteId`). Each website's agent has its own
persona + model config; unset model-tuning fields fall back to env defaults.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `websiteId` | `ObjectId` | ✅ | Ref → `websites` — **one agent per website** (unique). Created automatically when a website is created; the widget resolves the agent for the conversation's website. |
| `name` | `string` | ✅ | Agent display name (shown in widget) |
| `description` | `string` | — | Short description |
| `avatarUrl` | `string` | — | Agent avatar for widget |
| `welcomeMessage` | `string` | — | First automatic greeting |
| `suggestedQuestions` | `string[]` | — | Pre-chat suggestions |
| `systemPromptOverride` | `string` | — | Org-specific system prompt additions (appended to base) |
| `model` | `string` | — | LLM model override (default from env) |
| `temperature` | `number` | — | Model temperature (default 0.7) |
| `confidenceThreshold` | `number` | — | Minimum AI confidence score (0.0–1.0). Responses below this auto-escalate to human. Default: `0.7`. |
| `isActive` | `boolean` | ✅ | Whether agent is active |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ organizationId: 1 }` — list agents per org

---

### 6. `contactSessions`

> ⚠️ **Critical**: Email is NOT a unique index for conversation lookup. Identity is `contactSessionId` + session token only.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key (= `contactSessionId`) |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `websiteId` | `ObjectId` | ✅ | Ref → `websites` |
| `token` | `string` | ✅ | Opaque session token (UUID v4, stored in localStorage) |
| `email` | `string` | — | Contact email (CRM purposes only) |
| `phone` | `string` | — | Contact phone (CRM purposes only) |
| `name` | `string` | — | Contact name |
| `metadata` | `object` | — | Custom data from embed (e.g., `data-user-id`) |
| `ipAddress` | `string` | — | First-seen IP |
| `userAgent` | `string` | — | Browser UA string |
| `expiresAt` | `Date` | ✅ | Session expiration (24h from creation) |
| `lastActiveAt` | `Date` | ✅ | Last activity timestamp |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ token: 1 }` — unique, for session lookup
- `{ organizationId: 1, websiteId: 1 }` — list sessions per org/site
- `{ expiresAt: 1 }` — **TTL index** (MongoDB auto-deletes expired docs)
- `{ organizationId: 1, email: 1 }` — for CRM search (NOT for conversation lookup)

**Session TTL rules:**
- **Fixed window**: 24 hours from creation (simplest to implement)
- **Sliding window** (recommended): refresh `expiresAt` to `now + 24h` on every activity
- On expiry: localStorage token becomes invalid → widget creates new session → fresh conversation
- TTL index handles cleanup: `{ expiresAt: 1, expireAfterSeconds: 0 }`

---

### 7. `conversations`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `threadId` | `string` | ✅ | Unique thread identifier (UUID v4) |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `websiteId` | `ObjectId` | ✅ | Ref → `websites` |
| `agentId` | `ObjectId` | ✅ | Ref → `agents` |
| `contactSessionId` | `ObjectId` | ✅ | Ref → `contactSessions` |
| `status` | `string` | ✅ | `active` / `escalated` / `resolved` / `expired` |
| `assignedOperatorId` | `ObjectId` | — | Ref → `users` (assigned on escalation) |
| `subject` | `string` | — | Auto-generated from first message |
| `lastMessageAt` | `Date` | — | For inbox sorting |
| `lastMessagePreview` | `string` | — | Truncated last message text |
| `messageCount` | `number` | — | Total messages in thread |
| `resolvedAt` | `Date` | — | When conversation was resolved |
| `resolvedBy` | `string` | — | `ai` / `operator` / `system` |
| `escalatedAt` | `Date` | — | When escalated to human |
| `metadata` | `object` | — | Tags, priority, custom fields |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ threadId: 1 }` — unique
- `{ organizationId: 1, status: 1, lastMessageAt: -1 }` — inbox listing (sorted by recent)
- `{ organizationId: 1, websiteId: 1, status: 1 }` — filtered by website
- `{ contactSessionId: 1 }` — find conversations for a session
- `{ organizationId: 1, assignedOperatorId: 1 }` — operator's assigned conversations

**Status transitions:**
```
active → escalated (AI tool or operator action)
active → resolved (AI tool or operator action)
escalated → resolved (operator action)
escalated → active (operator reopens)
```

**Resolved conversation behavior:**
- AI auto-reply **stops** when `status = resolved`
- Widget shows "Conversation resolved" state with option to start new conversation
- If customer sends new message on resolved conversation → status flips back to `active` → AI resumes

---

### 8. `messages`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `conversationId` | `ObjectId` | ✅ | Ref → `conversations` |
| `organizationId` | `ObjectId` | ✅ | Denormalized for RLS queries |
| `role` | `string` | ✅ | `customer` / `ai` / `operator` / `system` |
| `content` | `string` | ✅ | Message text (Markdown supported) |
| `senderId` | `ObjectId` | — | Ref → `users` (for operator) or `contactSessions` (for customer) |
| `senderType` | `string` | ✅ | `contact` / `user` / `ai` / `system` |
| `attachments` | `array` | — | `[{ fileName, fileUrl, mimeType, size }]` |
| `toolCalls` | `array` | — | `[{ name, args, result }]` (for AI tool use) |
| `confidence` | `number` | — | AI self-assessed confidence score (0.0–1.0). Only present when `role = 'ai'`. Used for monitoring and auto-escalation. |
| `isEnhanced` | `boolean` | — | Whether message was AI-enhanced (operator messages) |
| `originalContent` | `string` | — | Pre-enhancement text (if enhanced) |
| `readByOperator` | `boolean` | — | Read receipt for inbox |
| `createdAt` | `Date` | auto | |

**Indexes:**
- `{ conversationId: 1, createdAt: 1 }` — thread messages in order
- `{ organizationId: 1, createdAt: -1 }` — global search
- `{ conversationId: 1, role: 1 }` — filter by sender type

---

### 9. `knowledgeSources`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `agentId` | `ObjectId` | ✅ | Ref → `agents` — **knowledge is keyed by (organizationId, agentId)**; the widget agent searches only `conversation.agentId`'s KB. Unique index `{ agentId, contentHash }`. (Each agent maps to one website.) |
| `type` | `string` | ✅ | `text` / `pdf` / `docx` / `excel` / `csv` / `image` / `html` / `website` |
| `title` | `string` | ✅ | Display name |
| `content` | `string` | — | Raw extracted text (for text type) |
| `fileUrl` | `string` | — | Object storage URL (for uploaded files) |
| `fileName` | `string` | — | Original filename |
| `mimeType` | `string` | — | File MIME type |
| `fileSize` | `number` | — | File size in bytes |
| `sourceUrl` | `string` | — | Original URL (for website/HTML type) |
| `contentHash` | `string` | ✅ | SHA-256 of normalized extracted text |
| `extractedText` | `string` | — | Full extracted text (post-processing) |
| `chunkCount` | `number` | — | Number of chunks created |
| `pineconeIds` | `string[]` | — | Vector IDs in Pinecone (for cleanup on delete) |
| `embeddingStatus` | `string` | ✅ | `pending` / `processing` / `synced` / `error` / `deleting` |
| `embeddingError` | `string` | — | Last error message if embedding failed |
| `lastSyncedAt` | `Date` | — | Last successful Pinecone sync |
| `retryCount` | `number` | — | Number of embedding retry attempts |
| `version` | `number` | ✅ | Document version (incremented on update) |
| `createdBy` | `ObjectId` | ✅ | Ref → `users` |
| `updatedBy` | `ObjectId` | — | Ref → `users` |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ organizationId: 1, contentHash: 1 }` — unique (dedup per org)
- `{ organizationId: 1, type: 1 }` — filter by type
- `{ organizationId: 1, embeddingStatus: 1 }` — find pending/error for retry
- `{ embeddingStatus: 1, retryCount: 1 }` — reconciliation job query

**Content hash dedup flow:**
1. On create/upload: extract text → normalize (lowercase, trim, collapse whitespace) → SHA-256
2. Query: `KnowledgeSource.findOne({ agentId, contentHash })` (dedup is per-agent)
3. If exists → reject with `409 Conflict` and message: "Duplicate content already exists"
4. If updating file → new hash → new version (increment `version`, replace Pinecone vectors)

---

### 10. `widgetSettings`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `agentId` | `ObjectId` | ✅ | Ref → `agents` |
| `title` | `string` | — | Widget header title |
| `subtitle` | `string` | — | Subtitle text |
| `welcomeMessage` | `string` | — | Greeting message |
| `suggestedQuestions` | `string[]` | — | Pre-chat suggestions |
| `primaryColor` | `string` | — | Brand color (hex) |
| `position` | `string` | — | `bottom-right` / `bottom-left` / `centered` |
| `theme` | `string` | `light` | `light` / `dark` / `auto` (auto follows prefers-color-scheme) |
| `showBranding` | `boolean` | `true` | Show "Powered by" footer in the widget |
| `avatarUrl` | `string` | — | Widget avatar (overrides the agent's avatar) |
| `offlineMessage` | `string` | — | Message when no operators online (persisted; not yet surfaced by the widget) |
| `requireContactBeforeChat` | `boolean` | — | If true, the pre-chat screen blocks the first message until a valid email is given (default: false) |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ organizationId: 1, agentId: 1 }` — unique

---

### 11. `subscriptions`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `paddleSubscriptionId` | `string` | ✅ | Paddle subscription ID |
| `paddleCustomerId` | `string` | ✅ | Paddle customer ID |
| `plan` | `string` | ✅ | `starter` / `pro` / `enterprise` |
| `status` | `string` | ✅ | `active` / `trialing` / `past_due` / `canceled` / `paused` |
| `currentPeriodStart` | `Date` | ✅ | |
| `currentPeriodEnd` | `Date` | ✅ | |
| `canceledAt` | `Date` | — | |
| `trialEndAt` | `Date` | — | |
| `paddleData` | `object` | — | Raw Paddle webhook data (for debugging) |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ organizationId: 1 }` — unique (one subscription per org)
- `{ paddleSubscriptionId: 1 }` — unique
- `{ status: 1 }` — filter active subscriptions

---

### 11b. `payments`

Transaction-level ledger. `subscriptions` holds the **current entitlement**;
this holds **what the customer was actually charged**. The two are written by
different paths on purpose: subscription events own the `organizations.plan`
entitlement mirror, and payment events never touch it, so a declined card raises
a dunning banner rather than revoking access the provider is still retrying.

`rawPayload` stores the entire webhook event rather than a trimmed copy. When a
charge is disputed months later, the argument is settled by what the provider
actually sent at the time, not by our interpretation of it.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `subscriptionId` | `ObjectId` | — | Ref → `subscriptions`. Null for one-off charges, or when Paddle sends the transaction before the subscription link lands |
| `provider` | `string` | ✅ | `paddle` |
| `providerTransactionId` | `string` | ✅ | Paddle `txn_…`. **Unique**, and the key every write upserts on — this is what makes replayed deliveries converge on one row |
| `providerInvoiceId` | `string` | — | Paddle `inv_…` / invoice number |
| `status` | `string` | ✅ | `pending` / `completed` / `failed` / `refunded` / `partially_refunded` / `disputed` |
| `amount` | `number` | ✅ | **Minor units** (cents), as the provider reports them. Never a float |
| `currency` | `string` | ✅ | ISO 4217 |
| `tax` | `number` | — | Minor units |
| `discount` | `number` | — | Minor units |
| `couponCode` | `string` | — | |
| `billingPeriod.start` / `.end` | `Date` | — | The period this charge covers |
| `paymentMethod.type` / `.last4` / `.brand` | `string` | — | From `data.payments[].method_details` |
| `invoiceUrl` / `receiptUrl` | `string` | — | Provider-hosted documents |
| `failureReason` | `string` | — | Decline code on a failure, chargeback reason on a dispute |
| `occurredAt` | `Date` | ✅ | When the **provider** says it happened, not when we processed it. Billing history sorts on this so a delayed delivery still reads correctly |
| `lastEventType` | `string` | — | Last event applied to this row |
| `lastEventOccurredAt` | `Date` | — | Drives the out-of-order guard: an older event may not overwrite a newer outcome |
| `adjustment` | `object` | — | Set when a refund or chargeback lands: `{ id, action, type, reason, amount, occurredAt, raw }`. Kept **beside** `rawPayload`, since a dispute is argued from both the original charge and the adjustment |
| `rawPayload` | `object` | ✅ | The complete webhook event, for dispute resolution |
| `createdAt` / `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ providerTransactionId: 1 }` — unique (idempotency + upsert key)
- `{ organizationId: 1, occurredAt: -1 }` — billing history, newest first
- `{ organizationId: 1, status: 1 }` — dunning and reconciliation sweeps

---

### 11c. `kbchunks`

The durable, queryable copy of every knowledge-base chunk. Two jobs, and the
second is why the first was affordable:

1. **Lexical retrieval.** A `$text` index catches exact rare tokens (order ids,
   error codes, SKUs, clause numbers) that dense vectors have no signal for.
2. **Chunk text stops living only in Pinecone metadata**, where it was truncated
   at 8000 characters and served as retrieval's source of truth. A vector store
   is an index, not a database.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `agentId` | `ObjectId` | ✅ | Ref → `agents`. Knowledge is keyed by (org, agent) and every query scopes to both |
| `sourceId` | `ObjectId` | ✅ | Ref → `knowledgeSources` |
| `chunkIndex` | `number` | ✅ | Position within the source |
| `chunkId` | `string` | ✅ | `<sourceId>:<chunkIndex>`, **unique**, identical to the Pinecone vector id — this is what lets the two legs fuse without a join |
| `text` | `string` | ✅ | The chunk as it appears in the document. **Never truncated** |
| `headingPath` | `string[]` | — | Heading stack above the chunk, outermost first |
| `url` | `string` | — | Per-page attribution for website sources |
| `tokenCount` | `number` | — | Rough (4 chars ≈ 1 token), for context-budget accounting |
| `createdAt` / `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ chunkId: 1 }` — unique; the fusion join key
- `{ text: "text", headingPath: "text" }` weighted 1 / 3 — lexical retrieval. A
  single text index per collection is a MongoDB limit, so the heading path is
  folded in rather than indexed separately
- `{ organizationId: 1, agentId: 1 }` — every lexical query filters on both
  before scoring
- `{ sourceId: 1, chunkIndex: 1 }` — re-ingest replaces a source's chunks

Deleting a source deletes its chunks: leaving them would keep a deleted document
lexically retrievable.

---

### 12. `sections`

Widget navigation sections (quick links/topics).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `agentId` | `ObjectId` | ✅ | Ref → `agents` |
| `title` | `string` | ✅ | Section title |
| `description` | `string` | — | Short description |
| `icon` | `string` | — | Icon name or emoji |
| `url` | `string` | — | Optional external link |
| `action` | `string` | — | `link` / `start-chat` / `topic` |
| `topicPrompt` | `string` | — | Pre-fill message if action = `topic` |
| `order` | `number` | ✅ | Sort order |
| `isActive` | `boolean` | ✅ | |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ organizationId: 1, agentId: 1, order: 1 }` — sorted sections per agent

---

### 13. `usagerecords`

Per-turn LLM cost records (one doc per `generateAiReply` invocation).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `websiteId` | `ObjectId` | — | Ref → `websites` |
| `conversationId` | `ObjectId` | — | Ref → `conversations` |
| `generationIds` | `string[]` | — | OpenRouter generation IDs for cost lookup |
| `model` | `string` | — | Model name (e.g. `openai/gpt-4o`) |
| `promptTokens` | `number` | — | Aggregated prompt tokens |
| `completionTokens` | `number` | — | Aggregated completion tokens |
| `totalTokens` | `number` | — | `promptTokens + completionTokens` |
| `costUsd` | `number` | — | Actual USD cost from OpenRouter |
| `period` | `string` | ✅ | `YYYY-MM` (pre-computed for fast monthly grouping) |
| `createdAt` | `Date` | auto | TTL: auto-delete after 2 years |

**Indexes:**
- `{ organizationId: 1, period: 1 }` — monthly org spend queries
- `{ websiteId: 1, period: 1 }` — monthly website spend queries
- `{ createdAt: 1 }` — TTL index (730 days)

---

### 14. `budgetalerts`

Deduplication guard — ensures each budget threshold email is sent at most once per entity × period × threshold.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `entityType` | `string` | ✅ | `org` or `website` |
| `entityId` | `ObjectId` | ✅ | Org or website ID |
| `period` | `string` | ✅ | `YYYY-MM` |
| `threshold` | `number` | ✅ | `75` or `100` |
| `sentAt` | `Date` | auto | TTL: auto-delete after 90 days |

**Indexes:**
- `{ entityId: 1, period: 1, threshold: 1 }` — unique (prevents duplicate sends)
- `{ sentAt: 1 }` — TTL index (90 days)

---

### 14b. `ragturnmetrics`

Per-turn RAG telemetry: what retrieval found and what generation did with it.
One document per customer turn, written fire-and-forget **after** the reply has
been persisted and emitted.

[`39-rag-evaluation.md`](39-rag-evaluation.md) scores a fixed golden set
offline. This collection answers the question that harness structurally cannot:
is the pipeline good *right now*, on the questions real customers are asking,
against the knowledge base this org actually wrote. A fixture set ages the moment
an operator uploads a document.

Shaped deliberately after `toolcalllogs` — same scoping, same masked-before-
persist rule, same `durationMs` and status enum, same `updatedAt: false`, same
TTL. Two telemetry collections with two sets of conventions is how a dashboard
ends up joining on nothing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | |
| `organizationId` | `ObjectId` | ✅ | Ref → `organizations` |
| `agentId` | `ObjectId` | ✅ | Ref → `agents` |
| `conversationId` | `ObjectId` | ✅ | Ref → `conversations` |
| `messageId` | `ObjectId` | ✅ | Ref → `messages`. Joins a metric to the reply it scores |
| `originalQuery` | `string` | — | The turn's first KB search, as the customer phrased it. **Masked through `piiMask` before persisting**, unconditionally |
| `rewrittenQuery` | `string` | — | What was actually embedded. Masked identically. Empty when the turn never searched |
| `retrieval.topK` | `number` | — | Final context size (`AI_KB_SEARCH_TOP_K`), not stage 1's widened candidate count |
| `retrieval.minScore` | `number` | — | The **loosest floor actually applied**, which is `0` on any search that fell through to widen-on-empty |
| `retrieval.hitCount` | `number` | — | Passages that reached the prompt, after fusion and reranking |
| `retrieval.topScore` / `meanScore` / `scoreSpread` | `number \| null` | — | Raw scores, always on the cosine scale: fusion keeps the best raw score per passage and reranking reorders without overwriting it |
| `retrieval.retrievalConfidence` | `number` | — | Normalised `[0,1]`. Derived, not a raw score — formula in [`39-rag-evaluation.md`](39-rag-evaluation.md) |
| `retrieval.widenedOnEmpty` | `boolean` | — | Stage 1 returned nothing and the no-floor retry ran |
| `retrieval.sourceIds` | `string[]` | — | Distinct knowledge sources behind the retrieved passages |
| `retrieval.latencyMs` | `number` | — | Every KB search this turn ran, summed |
| `retrieval.searchCount` | `number` | — | `search_kb` calls the model made. `0` means it never searched |
| `generation.confidence` | `number` | — | The meta pass's confidence, after any uncited-ratio penalty |
| `generation.action` | `string` | — | `reply` / `escalate` / `resolve` |
| `generation.citationCount` | `number` | — | Validated citations in the reply |
| `generation.citedSourceIds` | `string[]` | — | Distinct sources the reply actually cited |
| `generation.answerLength` | `number` | — | Characters. A shape signal, not a billing number |
| `generation.model` | `string` | — | The answering model for this turn |
| `generation.promptTokens` / `completionTokens` / `costUsd` | `number \| null` | — | **Null until OpenRouter resolves the generation**, then backfilled by the same call that writes the `UsageRecord`. Null means unknown; a fake `0` in a cost table reads as free |
| `generation.latencyMs` | `number` | — | The finalize node: streamed reply and meta pass, run concurrently |
| `flags.noHits` | `boolean` | — | Retrieval returned nothing to ground the reply in |
| `flags.lowConfidence` | `boolean` | — | Below `AI_CONFIDENCE_THRESHOLD` |
| `flags.escalated` | `boolean` | — | Handed to a human |
| `flags.conflicted` | `boolean` | — | Two sources contradicted each other on the queried fact |
| `toolTurns` | `number` | — | Agent↔tool round trips this turn spent |
| `faithfulness.sampled` | `boolean` | — | Drawn for online judging at `RAG_FAITHFULNESS_SAMPLE_RATE` |
| `faithfulness.score` | `number \| null` | — | Supported claims over total claims. **`sampled: true` with a null score is a distinct fact from not sampled** and must not be averaged with it |
| `faithfulness.claimCount` | `number \| null` | — | Atomic claims the judge found in the answer |
| `faithfulness.unsupported` | `object[]` | — | `{claim, verdict, reason}`, capped at 10. Masked: these are sentences lifted out of the reply |
| `faithfulness.judgeModel` | `string \| null` | — | Which judge produced the score |
| `faithfulness.judgedAt` | `Date` | — | |
| `faithfulness.skippedReason` | `string \| null` | — | `no_passages` / `budget_exceeded` / `no_claims` / `judge_error` |
| `status` | `string` | ✅ | `ok`, or `fallback` when the graph never produced a state and the safe reply stood |
| `durationMs` | `number` | ✅ | The whole turn, first byte of work to persisted reply |
| `createdAt` | `Date` | auto | No `updatedAt` |

**Indexes:**
- `{ createdAt: 1 }` — TTL, `RAG_TELEMETRY_RETENTION_DAYS` (default 90 days)
- `{ organizationId: 1, agentId: 1, createdAt: -1 }` — the dashboard's spine
- `{ organizationId: 1, createdAt: -1 }` — org rollups and the alert sweep's group-by
- `{ organizationId: 1, createdAt: -1 }` **partial** on each of `flags.noHits`,
  `flags.lowConfidence`, `flags.escalated`, `flags.conflicted`, and on
  `faithfulness.sampled` — the drill-downs read a small subset of a large
  collection, so a partial index scans the matching turns rather than the window
- `{ organizationId: 1, conversationId: 1 }` — inbox drill-down, mirroring `toolcalllogs`

Every query the dashboard runs is asserted to use one of these:
`src/__tests__/rag-telemetry.test.ts` runs each through `explain()` and fails on
a `COLLSCAN`.

---

### 15. `contactmessages`

Inbound sales/support inquiries from the **public** marketing "Contact Us" form
(`POST /public/contact`). Distinct from `contactSessions` (widget visitors tied to an
org/website) — these are unauthenticated and org-agnostic (Changelog 2).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_id` | `ObjectId` | auto | Primary key |
| `name` | `string` | ✅ | Submitter name |
| `email` | `string` | ✅ | Submitter email (lowercased) |
| `message` | `string` | ✅ | Message body |
| `ipAddress` | `string` | — | First-seen IP (abuse forensics) |
| `userAgent` | `string` | — | Submitting user agent |
| `status` | `string` | ✅ | `new` / `read` / `archived` (default `new`) |
| `createdAt` | `Date` | auto | |
| `updatedAt` | `Date` | auto | |

**Indexes:**
- `{ createdAt: -1 }`

---

## Entity Relationship Diagram

```mermaid
erDiagram
    organizations ||--o{ memberships : "has members"
    organizations ||--o{ websites : "owns"
    organizations ||--o{ agents : "configures"
    organizations ||--o{ knowledgeSources : "owns KB"
    organizations ||--o{ subscriptions : "billing"
    organizations ||--o{ contactSessions : "receives visitors"
    
    users ||--o{ memberships : "belongs to orgs"
    users ||--o{ messages : "sends (operator)"
    
    websites ||--o{ contactSessions : "visitors arrive at"
    websites ||--o{ conversations : "hosts"
    
    agents ||--o{ conversations : "handles"
    agents ||--o{ widgetSettings : "configured by"
    agents ||--o{ sections : "has sections"
    
    contactSessions ||--o{ conversations : "owns"
    
    conversations ||--o{ messages : "contains"
    
    organizations {
        ObjectId _id
        string name
        string slug
        string plan
    }
    
    users {
        ObjectId _id
        string email
        string name
        string role
    }
    
    memberships {
        ObjectId userId
        ObjectId organizationId
        string role
    }
    
    conversations {
        ObjectId _id
        string threadId
        ObjectId organizationId
        ObjectId contactSessionId
        string status
    }
    
    messages {
        ObjectId _id
        ObjectId conversationId
        string role
        string content
    }
    
    contactSessions {
        ObjectId _id
        string token
        Date expiresAt
        string email
    }
    
    knowledgeSources {
        ObjectId _id
        ObjectId organizationId
        string contentHash
        string embeddingStatus
    }
```

---

## RLS Enforcement Pattern

Every Mongoose query in the application MUST include `organizationId` from the authenticated context. Example middleware pattern:

```typescript
// middleware/org-context.middleware.ts
const orgContext = (req, res, next) => {
  const orgId = req.user.organizationId; // from JWT
  if (!orgId) return res.status(403).json({ error: 'No org context' });
  
  // Attach to request for all downstream queries
  req.orgId = orgId;
  next();
};

// In any service/controller:
const conversations = await Conversation.find({
  organizationId: req.orgId,  // ALWAYS include
  status: 'active'
}).sort({ lastMessageAt: -1 });
```

> ⚠️ Never accept `organizationId` from the request body without verifying the user is a member of that organization via the `memberships` collection.
