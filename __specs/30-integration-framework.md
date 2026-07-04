# 30 — Integration Framework (Tier 2A)

> **Status**: IMPLEMENTED — Phase 14 complete; `pnpm build` + `pnpm type-check` green
> **Depends on**: Tier 1 specs complete; `billing.service.ts` (Paddle patterns reused)
> **Blocks**: spec 31 (all 2B tools build on top of this framework)
> **Implementation plan**: [`__plans/14-integration-framework.md`](../__plans/14-integration-framework.md)

---

## Overview

The integration framework is the **single, generic tool-calling spine** that
powers all agentic connectors (Tier 2B). Operators wire their company's tools in
once (authenticate, configure), then toggle them on per-agent. The AI loop calls
these tools server-side with the operator's credentials; the LLM never sees raw
secrets.

Build order within 2A (each step is a prerequisite for the next):

1. **2A.1** Credential vault (encryption helper)
2. **2A.2** Data models (Connection, ToolDefinition, ToolCallLog)
3. **2A.3** OAuth + API-key connector flows (routes + per-provider adapters)
4. **2A.4** Custom webhook connector
5. **2A.5** Tool registry → AI loop wiring (dispatcher inside `generateAiReply`)
6. **2A.6** Guardrails enforcement
7. **2A.7** Per-tool / per-agent toggle
8. **2A.8** Audit log + inbox strip
9. **2A.9** Rate limit + retry
10. **2A.10** Sandbox toggle
11. **2A.11** Dashboard "Integrations" tab

---

## 2A.1 — Credential vault

### Problem
All existing secrets are either env vars or one-way hashes. OAuth refresh tokens
and per-org API keys require *reversible* storage; raw plaintext in MongoDB is
unacceptable.

### Design

**Helper — `apps/api/src/services/security/crypto.service.ts`**

AES-256-GCM envelope encryption. One master key (`CREDENTIALS_ENCRYPTION_KEY`),
stored as a 32-byte base64 string in the environment:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY = Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY!, "base64");

export function encrypt(plaintext: string): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decrypt(blob: EncryptedBlob): string {
  const decipher = createDecipheriv(
    ALGORITHM, KEY, Buffer.from(blob.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export interface EncryptedBlob {
  iv: string;
  ciphertext: string;
  authTag: string;
}
```

**Key validation on startup** — `apps/api/src/config/env.ts`:
```typescript
if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
  throw new Error("CREDENTIALS_ENCRYPTION_KEY is required");
}
const keyBuf = Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY, "base64");
if (keyBuf.length !== 32) {
  throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (base64-encoded)");
}
```

**Key generation command** (add to `package.json` scripts in `apps/api`):
```
"gen:cred-key": "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
```

### Key rotation strategy
**Decision: Option A — Static key (for launch).**

One `CREDENTIALS_ENCRYPTION_KEY` per environment (`development`, `staging`,
`production`). If the key is compromised, re-encrypt all `Connection` documents
via a migration script.

The `keyVersion: number` field on `EncryptedBlob` (default `1`) is stored
alongside every encrypted record so a future migration can identify which key
version encrypted it without re-decrypting everything first. When rotating:
1. Generate a new key (`gen:cred-key`), deploy it alongside the old one as
   `CREDENTIALS_ENCRYPTION_KEY_PREV`.
2. Run migration: decrypt with old key, re-encrypt with new key, update
   `keyVersion`.
3. Remove `CREDENTIALS_ENCRYPTION_KEY_PREV`.

### New env var
`CREDENTIALS_ENCRYPTION_KEY` — 32 bytes, base64-encoded. Add to `.env.example`.

---

## 2A.2 — Data models

### `Connection` — `apps/api/src/models/Connection.ts`
```typescript
{
  organizationId:         { type: ObjectId, ref: "Organization", required: true },
  provider:               { type: String, required: true },  // "calcom" | "calendly" | "stripe" | "paddle" | "shopify" | "linear" | "jira" | "webhook"
  name:                   { type: String, required: true },  // operator-defined label
  authMode:               { type: String, enum: ["oauth", "apikey", "webhook"], required: true },
  status:                 { type: String, enum: ["active", "disconnected", "error"], default: "active" },
  sandbox:                { type: Boolean, default: false },
  encryptedCredentials:   {                                  // AES-256-GCM blob
    iv:         { type: String, required: true },
    ciphertext: { type: String, required: true },
    authTag:    { type: String, required: true },
    keyVersion: { type: Number, default: 1 },
  },
  scopes:                 [{ type: String }],               // OAuth scopes granted
  expiresAt:              { type: Date },                    // OAuth access token expiry
  createdBy:              { type: ObjectId, ref: "User" },
  lastUsedAt:             { type: Date },
  createdAt:              { type: Date, default: Date.now },
  updatedAt:              { type: Date, default: Date.now },
}
// Indexes: { organizationId:1, provider:1 }
```

**Credentials payload shape** (stored as an encrypted JSON string):

```typescript
// OAuth providers
interface OAuthCredentials {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number;   // unix ms
  scope:        string;
}

// API key providers
interface ApiKeyCredentials {
  apiKey: string;
}

// Webhook connector
interface WebhookCredentials {
  endpointUrl: string;
  authHeader:  string;  // e.g. "Authorization: Bearer <token>"
  inputSchema: object;  // JSON Schema for tool args
  outputSchema: object; // JSON Schema for tool result
}
```

---

### `ToolDefinition` — `apps/api/src/models/ToolDefinition.ts`
```typescript
{
  connectionId:    { type: ObjectId, ref: "Connection", required: true },
  organizationId:  { type: ObjectId, ref: "Organization", required: true },
  key:             { type: String, required: true },          // e.g. "book_meeting", "refund_payment"
  displayName:     { type: String, required: true },          // shown in dashboard
  description:     { type: String, required: true },          // operator-editable; injected into LLM tool list
  jsonSchema:      { type: Object, required: true },          // OpenAI function-call parameter schema
  guardrails:      { type: Object, default: {} },             // see 2A.6
  enabledAgentIds: [{ type: ObjectId, ref: "Agent" }],        // empty = disabled everywhere
  isActive:        { type: Boolean, default: true },
  createdAt:       { type: Date, default: Date.now },
  updatedAt:       { type: Date, default: Date.now },
}
// Indexes: { connectionId:1, key:1 } unique, { organizationId:1 }
```

---

### `ToolCallLog` — `apps/api/src/models/ToolCallLog.ts`
```typescript
{
  organizationId:  { type: ObjectId, ref: "Organization", required: true },
  agentId:         { type: ObjectId, ref: "Agent", required: true },
  conversationId:  { type: ObjectId, ref: "Conversation", required: true },
  contactSessionId:{ type: ObjectId, ref: "ContactSession" },
  connectionId:    { type: ObjectId, ref: "Connection", required: true },
  toolKey:         { type: String, required: true },          // e.g. "book_meeting"
  argsMasked:      { type: Object, required: true },          // PII-stripped copy of args
  resultSummary:   { type: String, maxlength: 500 },          // short human-readable outcome
  status:          { type: String, enum: ["success", "error", "guardrail_blocked", "rate_limited"] },
  errorMessage:    { type: String },
  durationMs:      { type: Number },
  createdAt:       { type: Date, default: Date.now },
}
// Indexes: { organizationId:1, createdAt:-1 }, { conversationId:1 }
// TTL: 90 days (add TTL index on createdAt)
```

---

## 2A.3 — OAuth + API-key connector flows

### Provider adapter interface

Each provider lives at `apps/api/src/services/integrations/providers/<name>.ts`
and implements:

```typescript
export interface ProviderAdapter {
  readonly key: string;              // "calcom" | "calendly" | etc.
  readonly displayName: string;
  readonly authMode: "oauth" | "apikey" | "webhook";
  readonly oauthConfig?: {
    authorizeUrl: string;
    tokenUrl: string;
    scopes: string[];
    clientIdEnv: string;            // env var name, e.g. "CALCOM_CLIENT_ID"
    clientSecretEnv: string;
  };
  // Returns OAuth redirect URL
  buildAuthUrl?(state: string): string;
  // Exchange code for tokens; returns raw credential payload
  exchangeCode?(code: string): Promise<OAuthCredentials>;
  // Refresh access token; returns updated credential payload
  refreshTokens?(refreshToken: string): Promise<OAuthCredentials>;
  // List tools this connection exposes (called after auth to populate ToolDefinitions)
  getTools(): ToolTemplate[];
  // Execute a single tool call with decrypted credentials
  execute(toolKey: string, args: object, credentials: string): Promise<object>;
}
```

**Sandbox routing**: adapters check `connection.sandbox` to switch between
production and sandbox endpoints (e.g. Paddle `sandbox.paddle.com` vs `paddle.com`).

### Routes — `apps/api/src/routes/integrations.routes.ts`

```
GET    /integrations                      → list all available providers + org's connections
GET    /integrations/:connectionId        → single connection (status, sandbox, tools)
POST   /integrations/:provider/connect   → {sandbox?} → returns {authUrl} for OAuth or
                                           accepts {apiKey} for API-key providers
GET    /integrations/:provider/callback  → OAuth code exchange (redirect from provider)
                                           stores encrypted credentials, seeds ToolDefinitions
PATCH  /integrations/:connectionId       → update name, sandbox, ToolDefinition overrides
DELETE /integrations/:connectionId       → revoke + delete connection + ToolDefinitions
```

Auth for all routes: `authenticateOperator` middleware (JWT).

### OAuth callback flow

```
1. Operator clicks "Connect Cal.com" in dashboard
2. POST /integrations/calcom/connect → server builds authUrl with state=<org>:<nonce>
3. Operator is redirected to Cal.com authorize screen
4. Cal.com redirects to GET /integrations/calcom/callback?code=...&state=...
5. Server validates state, exchanges code for tokens, encrypts credentials
6. Server creates/upserts Connection document
7. Server calls adapter.getTools() → upserts ToolDefinition documents
8. Redirect operator to /app/integrations (dashboard)
```

### Background token refresh

A recurring job (`apps/api/src/jobs/refreshOAuthTokens.ts`) runs every 15 minutes:
- Queries `Connection` documents where `expiresAt < now + 10min` and `authMode === "oauth"`.
- Calls `adapter.refreshTokens(refreshToken)`.
- Updates `encryptedCredentials` in-place.
- Sets `status: "error"` on refresh failure (operator sees a red badge in dashboard).

### User actions required — registering OAuth apps

For each OAuth provider, the operator (or the platform developer deploying this
SaaS) must create an OAuth application and obtain client credentials:

| Provider | Where to register | Redirect URI | Env vars |
|---|---|---|---|
| **Cal.com** | `app.cal.com/settings/developer/oauth-clients` | `{API_BASE_URL}/api/v1/integrations/calcom/callback` | `CALCOM_CLIENT_ID`, `CALCOM_CLIENT_SECRET` |
| **Calendly** | `developer.calendly.com` | `{API_BASE_URL}/api/v1/integrations/calendly/callback` | `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET` |
| **Stripe** | `dashboard.stripe.com/settings/connect/oauth` (Connect) | `{API_BASE_URL}/api/v1/integrations/stripe/callback` | `STRIPE_CLIENT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| **Shopify** | `partners.shopify.com` → create app | `{API_BASE_URL}/api/v1/integrations/shopify/callback` | `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` |
| **Linear** | `linear.app/settings/api` | `{API_BASE_URL}/api/v1/integrations/linear/callback` | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` |
| **Jira/Atlassian** | `developer.atlassian.com` → create OAuth 2.0 app | `{API_BASE_URL}/api/v1/integrations/jira/callback` | `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` |

> **Blocker — registration requires a deployed, public HTTPS domain.**
> OAuth redirect URIs cannot be `localhost`. Register apps only after the
> production API is deployed and the domain (`API_BASE_URL`) is known.
>
> **Blocker — Stripe Connect requires platform approval.**
> Stripe Connect (for multi-merchant refunds) requires applying for platform
> access at `stripe.com/docs/connect`. Approval can take days to weeks.
> Start this application immediately to avoid blocking the refund tool.

---

## 2A.4 — Custom webhook connector

### Design

The `webhook` provider adapter accepts:
- `endpointUrl` — HTTPS URL the adapter will POST to
- `authHeader` — full `Authorization: Bearer ...` header value (encrypted)
- `inputSchema` — JSON Schema for the tool's args (operator-defined)
- `outputSchema` — JSON Schema for the result (used to validate and summarize)

On execution:
1. Decrypt credentials → get `endpointUrl`, `authHeader`, `inputSchema`, `outputSchema`.
2. Validate `args` against `inputSchema` using `ajv`.
3. POST `args` to `endpointUrl` with the auth header. Timeout: `WEBHOOK_TIMEOUT_MS`
   (default: 10s, configurable).
4. Validate response against `outputSchema` (warn but do not fail if mismatch).
5. Return response body to the tool dispatcher.

**SSRF protections (mandatory)**

```typescript
import { Resolver } from "dns/promises";

const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^::1$/,
  /^fd[0-9a-f]{2}:/i,
];

async function assertSafeUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS endpoints are allowed");
  const addresses = await new Resolver().resolve4(parsed.hostname);
  for (const addr of addresses) {
    if (PRIVATE_RANGES.some(r => r.test(addr))) {
      throw new Error(`Endpoint resolves to private IP ${addr} — blocked`);
    }
  }
}
```

Also enforce: max response size 100 kB, no redirects (follow: `"manual"`).

### User actions required
None platform-side. The operator supplies their own endpoint credentials.

---

## 2A.5 — Tool registry → AI loop wiring

### Design

In `apps/api/src/services/ai/agent.service.ts`, `generateAiReply()`:

**Step 1 — Load enabled ToolDefinitions for the agent**
```typescript
const toolDefs = await ToolDefinition.find({
  organizationId,
  enabledAgentIds: agentId,
  isActive: true,
}).populate("connectionId");
```

**Step 2 — Build LLM tool list**
Merge integration tools alongside existing built-in tools:
```typescript
const llmTools: Tool[] = [
  ...BUILT_IN_TOOLS,                    // search_kb, escalate, resolve
  ...toolDefs.map(td => ({
    type: "function",
    function: {
      name: td.key,
      description: td.description,       // operator-editable
      parameters: td.jsonSchema,
    },
  })),
];
```

**Step 3 — Dispatcher inside tool loop**
```typescript
async function dispatchToolCall(
  toolCall: LLMToolCall,
  context: { org, agent, conversation, contactSession }
): Promise<object> {
  // Built-in tools handled first
  if (BUILT_IN_TOOL_KEYS.includes(toolCall.name)) {
    return dispatchBuiltIn(toolCall, context);
  }

  // Integration tool
  const toolDef = toolDefs.find(td => td.key === toolCall.name);
  if (!toolDef) throw new Error(`Unknown tool: ${toolCall.name}`);

  // Guardrail check (2A.6)
  const guardResult = evaluateGuardrails(toolDef.guardrails, toolCall.args, context);
  if (!guardResult.allowed) {
    await writeToolCallLog({ ...context, toolDef, args: toolCall.args, status: "guardrail_blocked", ... });
    return { error: guardResult.reason };   // model will explain to customer
  }

  // Rate limit check (2A.9)
  const allowed = await checkRateLimit(toolDef.connectionId, context.contactSession._id);
  if (!allowed) {
    await writeToolCallLog({ ...context, toolDef, args: toolCall.args, status: "rate_limited", ... });
    return { error: "Rate limit exceeded. Please try again later." };
  }

  // Decrypt credentials
  const credentials = decrypt(toolDef.connectionId.encryptedCredentials);

  // Execute via provider adapter
  const adapter = getAdapter(toolDef.connectionId.provider);
  const start = Date.now();
  let result: object;
  try {
    result = await adapter.execute(toolDef.key, toolCall.args, credentials);
  } catch (err) {
    await writeToolCallLog({ ...context, toolDef, args: toolCall.args, status: "error", error: err.message, durationMs: Date.now()-start });
    return { error: "The action failed. Would you like me to escalate to a human?" };
  }

  await writeToolCallLog({ ...context, toolDef, args: toolCall.args, status: "success", result, durationMs: Date.now()-start });
  return result;
}
```

**Tool loop cap**: raise from 6 to 10 turns to accommodate multi-step tool
conversations (slot browsing → selection → booking).

**Token budget**: add a guard: if `toolDefs.length > 15`, log a warning; the
context window may approach limits. Operators with many tools should rely on
per-agent filtering (2A.7).

---

## 2A.6 — Guardrails (server-side enforcement)

### Design

`guardrails` is a flexible JSON object on `ToolDefinition`. The evaluator interprets
well-known constraint keys; unknown keys are logged but not enforced:

```typescript
interface GuardrailSpec {
  // refund_payment
  maxAmount?: number;            // max refund in cents (USD)
  maxDaysSincePurchase?: number; // refund window
  requireOrderOwnership?: boolean;

  // upgrade_subscription
  planDirection?: "upgrade_only" | "downgrade_only" | "any";
  requireBillingOwner?: boolean;

  // book_meeting
  businessHoursUtc?: { start: number; end: number; days: number[] }; // hours 0-23, days 0-6
  allowedAttendeeIds?: string[];  // limit to specific calendar attendees
}

function evaluateGuardrails(
  spec: GuardrailSpec,
  args: object,
  ctx: { contactSession; conversation }
): { allowed: boolean; reason?: string } {
  if (spec.maxAmount && args.amount > spec.maxAmount) {
    return { allowed: false, reason: `Refund amount ${args.amount} exceeds maximum ${spec.maxAmount}` };
  }
  if (spec.businessHoursUtc) {
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();
    const { start, end, days } = spec.businessHoursUtc;
    if (!days.includes(day) || hour < start || hour >= end) {
      return { allowed: false, reason: "Booking is only available during business hours" };
    }
  }
  // ... etc.
  return { allowed: true };
}
```

**Identity binding — OTP verification (decided)**

**Decision: OTP sent via email.** Before executing any high-stakes tool
(`refund_payment`, `upgrade_subscription`, `downgrade_subscription`,
`cancel_subscription`), the widget sends a one-time code to
`contactSession.email` and blocks the tool until the customer enters it.

Flow:
1. AI calls a high-stakes tool.
2. Dispatcher detects `guardrails.requireIdentityVerification: true` on the
   `ToolDefinition`.
3. Dispatcher does **not** execute the tool. Instead it returns a special
   sentinel result:
   `{ otpRequired: true, otpToken: "<signed-jwt-valid-60s>" }` to the model.
4. The model emits the token as a `FormBlock` (spec 32 § 3.2):
   a single `text` field labelled "Enter the 6-digit code we just sent to your
   email."
5. The API sends the OTP email via SMTP (`mailer.service.ts`, same pattern as
   invite emails). OTP: 6-digit, 10-minute TTL, stored in Redis/memory keyed by
   `otp:<otpToken>:<hash>`.
6. Customer submits the form. The API validates OTP → marks the session as
   `identityVerified: true` for 15 minutes (`ContactSession.identityVerifiedUntil`).
7. AI re-calls the tool. Dispatcher sees `identityVerifiedUntil > now` → proceeds.

**Scope**: OTP required for `refund_payment`, `upgrade_subscription`,
`downgrade_subscription`, `cancel_subscription`. Not required for `book_meeting`
or `create_support_ticket` (lower risk).

**New fields**:
- `ContactSession.identityVerifiedUntil?: Date` — set on successful OTP; checked
  by dispatcher for high-stakes tools.
- `ToolDefinition.guardrails.requireIdentityVerification?: boolean`

**New env var**: `OTP_EXPIRY_SECONDS` (default: `600`, i.e. 10 minutes).

---

## 2A.7 — Per-tool / per-agent toggle

### Design

- `ToolDefinition.enabledAgentIds: ObjectId[]` — empty array = disabled everywhere.
- When the operator enables a tool for an agent, push `agentId` into the array.
- In `generateAiReply()`, the tool-def query filters by `enabledAgentIds: agentId`
  (done in 2A.5 above — no additional step).
- **Dashboard UI**: in the new Integrations tab (2A.11), each tool card shows a
  per-agent toggle list.

---

## 2A.8 — Audit log + inbox strip

### Writing the log
See dispatcher in 2A.5 — `writeToolCallLog()` fires on every tool call
(success, error, guardrail_blocked, rate_limited).

**PII masking** in `argsMasked`:
```typescript
const PII_PATTERNS = [
  { pattern: /\b[\w.-]+@[\w.-]+\.[a-z]{2,}\b/gi, replacement: "[EMAIL]" },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: "[CC]" },
  { pattern: /\b\+?[\d\s()-]{7,15}\d\b/g, replacement: "[PHONE]" },
];

function maskPii(obj: object): object {
  let str = JSON.stringify(obj);
  for (const { pattern, replacement } of PII_PATTERNS) {
    str = str.replace(pattern, replacement);
  }
  return JSON.parse(str);
}
```

This same `maskPii()` helper is the shared implementation for Tier 5 PII redaction
(spec 34, 5.1) — build once here.

### Inbox strip

In `apps/web` operator inbox thread view, after each AI message that has
associated `ToolCallLog` entries, render a collapsed activity strip:

```
▸ AI booked a 30-min call — Thu Jun 25, 3:00 PM  [expand]
```

Expanded view shows: tool name, args (PII-masked), result summary, status badge,
duration.

API: `GET /conversations/:id/tool-calls` → returns `ToolCallLog[]` for the
conversation. Auth: operator JWT.

---

## 2A.9 — Rate limit + retry

### Design

Per-`(connectionId, contactSessionId)` sliding-window rate limit.

```typescript
// In apps/api/src/services/integrations/rateLimit.ts
const LIMITS: Record<string, { requests: number; windowMs: number }> = {
  default:  { requests: 10, windowMs: 60_000 },
  calcom:   { requests: 5,  windowMs: 60_000 },
  calendly: { requests: 5,  windowMs: 60_000 },
  stripe:   { requests: 3,  windowMs: 60_000 },
  paddle:   { requests: 3,  windowMs: 60_000 },
};

async function checkRateLimit(connectionId: string, sessionId: string): Promise<boolean> {
  const key = `rate:${connectionId}:${sessionId}`;
  const provider = connection.provider;
  const limit = LIMITS[provider] ?? LIMITS.default;

  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, limit.windowMs);
    return count <= limit.requests;
  }
  // In-memory fallback (single-process only)
  return inMemoryRateLimit(key, limit);
}
```

On rate limit: return `{ error: "..." }` to the model. The model is instructed
(Layer 5 of system prompt) to respond gracefully: "I couldn't complete that action
right now. Would you like me to connect you with a human?"

---

## 2A.10 — Sandbox toggle

### Design

`Connection.sandbox: boolean`. Each provider adapter checks this flag:

```typescript
execute(toolKey, args, credentials, sandbox) {
  const baseUrl = sandbox ? this.sandboxBaseUrl : this.productionBaseUrl;
  // ...
}
```

Sandbox credentials are separate (see credentials checklist in ROADMAP.md).
Widget Studio preview mode automatically uses sandbox connections.

### User actions required
For each provider, obtain separate sandbox/test credentials and add them to the
`.env.example` as `*_SANDBOX_*` variants. In practice, most providers use the
same OAuth client in test mode with a `sandbox: true` flag in the credentials or
a different endpoint domain.

---

## 2A.11 — Dashboard "Integrations" tab

### Location
`apps/web/src/app/(dashboard)/app/integrations/page.tsx`

Add to the "Configure" nav group in `apps/web/src/components/layouts/app-shell.tsx`
(between "Knowledge Base" and "AI Agent" in the sidebar).

### Page structure

```
/app/integrations
├── Header: "Integrations" + "Add connector" button
├── Installed connectors list
│   └── ConnectorCard: provider logo, name, status badge (active/error/disconnected),
│                      sandbox indicator, "Manage" link, "Disconnect" button
└── Available connectors grid
    └── ProviderCard: logo, name, description, "Connect" button
        → triggers OAuth flow or API-key modal

/app/integrations/:connectionId
├── Connection details (name, provider, status, scopes, sandbox toggle)
├── ToolDefinitions list
│   └── ToolCard: key, displayName, editable description, guardrails editor,
│                 per-agent toggle switches
└── Test tool (sandbox only): manually invoke with sample args, see result
```

### Tool guardrails editor

Structured form (not raw JSON) with fields per guardrail type:
- Refund: "Max refund amount ($)" + "Refund window (days)"
- Subscription: "Allowed directions" dropdown
- Meeting: "Business hours" time range + day checkboxes

---

## Files summary

| File | Change |
|---|---|
| `apps/api/src/services/security/crypto.service.ts` | New — AES-256-GCM vault |
| `apps/api/src/config/env.ts` | Add `CREDENTIALS_ENCRYPTION_KEY` validation |
| `apps/api/src/models/Connection.ts` | New model |
| `apps/api/src/models/ToolDefinition.ts` | New model |
| `apps/api/src/models/ToolCallLog.ts` | New model |
| `apps/api/src/routes/integrations.routes.ts` | New routes |
| `apps/api/src/services/integrations/providers/*.ts` | Per-provider adapters |
| `apps/api/src/services/integrations/dispatcher.ts` | Tool dispatch + guardrails |
| `apps/api/src/services/integrations/rateLimit.ts` | Rate limit helper |
| `apps/api/src/services/integrations/piiMask.ts` | Shared PII masking (reused by Tier 5) |
| `apps/api/src/jobs/refreshOAuthTokens.ts` | Background token refresh |
| `apps/api/src/services/ai/agent.service.ts` | Load ToolDefs, merge into llmTools, dispatchToolCall |
| `apps/web/src/app/(dashboard)/app/integrations/` | New dashboard page + components |
| `apps/web/src/components/layouts/app-shell.tsx` | Add Integrations nav item |
| `.env.example` | New env vars (see list below) |

## New env vars

| Variable | Required | Description |
|---|---|---|
| `CREDENTIALS_ENCRYPTION_KEY` | ✅ | 32-byte base64 key for AES-256-GCM credential storage |
| `CALCOM_CLIENT_ID` | — | Cal.com OAuth app client ID |
| `CALCOM_CLIENT_SECRET` | — | Cal.com OAuth app client secret |
| `CALENDLY_CLIENT_ID` | — | Calendly OAuth app client ID |
| `CALENDLY_CLIENT_SECRET` | — | Calendly OAuth app client secret |
| `STRIPE_CLIENT_ID` | — | Stripe Connect platform client ID |
| `STRIPE_SECRET_KEY` | — | Stripe secret key (platform account) |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signing secret |
| `SHOPIFY_CLIENT_ID` | — | Shopify partner app client ID |
| `SHOPIFY_CLIENT_SECRET` | — | Shopify partner app client secret |
| `LINEAR_CLIENT_ID` | — | Linear OAuth app client ID |
| `LINEAR_CLIENT_SECRET` | — | Linear OAuth app client secret |
| `ATLASSIAN_CLIENT_ID` | — | Atlassian (Jira) OAuth 2.0 client ID |
| `ATLASSIAN_CLIENT_SECRET` | — | Atlassian (Jira) OAuth 2.0 client secret |
| `WEBHOOK_TIMEOUT_MS` | — | Max ms for custom webhook calls (default: 10000) |
| `OTP_EXPIRY_SECONDS` | — | OTP validity window for identity verification (default: 600) |

## Acceptance

- [ ] `CREDENTIALS_ENCRYPTION_KEY` missing → API fails to start with a clear error.
- [ ] Encrypting and decrypting a string with `crypto.service.ts` returns the original.
- [ ] OAuth flow: clicking "Connect Cal.com" → redirect → callback → Connection document in Mongo with `encryptedCredentials`.
- [ ] Decrypting the stored credentials returns the original access/refresh tokens.
- [ ] Custom webhook: SSRF-blocked URL returns 400; valid HTTPS URL executes and returns result.
- [ ] Guardrail block: tool call exceeding `maxAmount` returns a graceful refusal message.
- [ ] `ToolCallLog` written for every execution (success and failure).
- [ ] Integrations tab visible in dashboard; shows connected and available providers.
