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

Every integration acts on the **operator's own account** (the account of the website
embedding the widget), never the platform's — see the memory notes
`integrations-target-operator-website` / `paddle-two-contexts`.

## Integration catalog — use cases & UX

Each connector is configured in the **Integrations** tab (operator brings their own
OAuth app / API key, encrypted at rest) and toggled on per-agent in **AI agent
settings**. What each one is for, and how the widget customer experiences it:

| Integration | Auth | Tools | Use case | Widget-customer UX |
|---|---|---|---|---|
| **Cal.com** | API key | `list_event_types`, `list_calendar_slots`, `book_meeting` | Let a visitor book a meeting on the operator's Cal.com calendar (demos, support calls). | "I'd like a demo" → AI lists meeting types, then available slots as tappable **cards** in the visitor's timezone → visitor picks one → inline **name** form → booked, with a "Join meeting" confirmation card. |
| **Calendly** | OAuth | `list_calendar_slots`, `book_meeting` | Same as Cal.com for operators on Calendly. | Same slot-card → pick → book flow. |
| **Stripe** | API key (or OAuth Connect) | `look_up_order`, `issue_refund`, `get_subscription`, `upgrade_subscription`, `downgrade_subscription`, `cancel_subscription` | Look up a payment/order, issue a refund, and let a visitor self-manage **their own** subscription on the operator's Stripe (Changelog 6 mirrors the Paddle subscription tool set — same email-keyed resolution, plan→price-id map via "Configure plans", proration, cancel-at-period-end). Connect with a **secret/restricted key** (`sk_test_…`/`sk_live_…`) — the common case of wiring your OWN Stripe, no Connect needed; the adapter still supports Connect OAuth tokens. Keys are checked for test-vs-live matching the environment. | "Upgrade me to Pro" → AI verifies by email + OTP → changes the plan (interval preserved) → confirms. "I want a refund for order X" → looks it up → refunds within guardrails. |
| **Shopify** | OAuth | `look_up_order` | Order/shipping status lookup on the operator's Shopify store. | "Where's my order?" → AI returns status/tracking. |
| **Jira** | OAuth (Atlassian 3LO) | `create_support_ticket` | File a support ticket in the operator's Jira when the AI can't resolve an issue (routes to a configured project; attaches a PII-masked transcript). | "This is still broken" → AI files a ticket and tells the customer a human will follow up (never leaks the internal ticket URL). |
| **Linear** | OAuth | `create_support_ticket` | Same as Jira for operators on Linear. | Ticket filed; human follow-up promised. |
| **Paddle** | API key | `get_subscription`, `upgrade_subscription`, `downgrade_subscription`, `cancel_subscription` | Let a visitor self-manage **their own** subscription in the **operator's** Paddle (the operator maps their plans→price ids in "Configure plans"). NOT platform billing. | "Upgrade me to Pro" → AI verifies the account by the visitor's email, changes the plan (preserving billing interval), confirms the new plan. |
| **Custom Webhook** | API key/header | operator-defined (e.g. `lookup_order`) | Point the AI at ANY operator HTTP endpoint with a JSON-schema-defined input, for anything the built-in connectors don't cover. | AI collects the schema's inputs via an inline form and calls the endpoint, presenting the result conversationally. |

Cross-cutting UX: tools start **disabled per agent** (operator opts each in), every call
is **guardrail-checked + rate-limited + audit-logged**, an inline **form** collects any
inputs the customer must supply, and OAuth/API-key apps are **per-environment**
(sandbox vs production, connected independently).

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

`INTEGRATION_ALLOWED_TOOLS` (optional, 2026-07 batch) — a **display allow-list** for the
integrations page. Comma-separated provider ids (`jira,stripe,webhook`; valid ids: `calcom,
calendly, stripe, shopify, linear, jira, paddle, webhook`). Only listed providers appear in the
`GET /integrations` catalog; unset/empty shows all. Matching is case-insensitive + whitespace
trimmed; unknown ids are silently ignored. Parsed in `config/env.ts` to
`env.integrationAllowedTools` (`Set<string> | null`) and applied ONLY to the `providers` catalog
in the `GET /integrations` handler — it never affects `getAdapter`, connect/execute, the
dispatcher, or existing connections (a hidden-but-connected integration keeps working).

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
  encryptedCredentials:   {                                  // AES-256-GCM blob — ACTIVE creds the dispatcher uses (mirror of the current environment's slot)
    iv:         { type: String, required: true },
    ciphertext: { type: String, required: true },
    authTag:    { type: String, required: true },
    keyVersion: { type: Number, default: 1 },
  },
  // Per-environment credential slots so one connection can hold BOTH sandbox and
  // production api-keys and switch `sandbox` without re-entering (see 2A.10).
  sandboxCredentials:     { /* same AES-256-GCM blob shape, optional */ },
  productionCredentials:  { /* same AES-256-GCM blob shape, optional */ },
  // Per-connection rate limits (see 2A.9)
  rateLimitPerSession:    { type: Number, default: 10 },     // per-visitor cap
  rateLimitPerConnection: { type: Number, default: 0 },      // all-visitors cap (0 = none)
  rateLimitWindowMs:      { type: Number, default: 60000 },
  description:            { type: String },                  // operator note, passed to AI as tool guidance
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

**Graceful-fail on a not-connected environment (Changelog 1)**: the dispatcher
reads the **active** environment's credential slot (`sandboxCredentials` /
`productionCredentials`), not just the `encryptedCredentials` mirror. When the
active environment has no credentials but the other one does, the tool call returns
`{ ok:false, status:"guardrail_blocked", reason:"…this integration's <env>
environment isn't connected…" }` instead of silently using the other environment's
creds. This lets an operator switch to a not-connected environment and watch the
agent degrade cleanly. **(Changelog 2)** The Sandbox/Production segmented control
surfaces this state directly: when the selected environment has no stored
credentials it shows an amber "Not connected — tool calls will fail here" badge, so
staying on an unconnected environment reads as intentional rather than broken.

**Connect-immediately (Changelog 1)**: in the dashboard, entering an OAuth Client ID
(and Client Secret) can proceed straight to authorization — **Save & connect** stores
them then calls `POST /integrations/:provider/connect` and redirects to the returned
`authUrl`. **Save Client ID** stores/updates the values without connecting.

**Client Secret required (Changelog 3)**: Jira, Linear, Shopify, Calendly and Stripe
Connect are **confidential OAuth clients** — the code→token exchange needs the client
secret. The `OAuthAppModal` therefore has a write-only **Client Secret** field (blank
= keep the stored one; the value is never returned, only `hasSecret`), and **Save &
connect** requires a secret when none is stored. This reverses Changelog 1/11's
"Client ID only" simplification, which had left these providers unable to obtain a
token (connections were stored tokenless yet marked "active"). Relatedly, every
provider's `exchangeCode` now throws on a missing secret or a non-2xx / no-`access_token`
response instead of silently storing an empty, fake-"Connected" credential.

### Routes — `apps/api/src/routes/integrations.routes.ts`

```
GET    /integrations                      → list all available providers + org's connections
GET    /integrations/:connectionId        → single connection (status, sandbox, tools)
GET    /integrations/:provider/oauth-app?environment=sandbox|production → that env's
                                           OAuth app config: {configured, clientId,
                                           hasSecret, redirectUri, defaultRedirectUri}.
                                           Secret never returned.
PUT    /integrations/:provider/oauth-app  → save the operator's OAuth app for one env.
                                           Requires clientId; **clientSecret is required
                                           to CONNECT confidential providers** (Jira/
                                           Linear/Shopify/Calendly/Stripe) — Changelog 3
                                           (encrypted at rest as encryptedClientSecret;
                                           blank on save keeps the stored one). The redirect
                                           URI is no longer collected — the fixed platform
                                           callback is always used and shown read-only for
                                           the operator to register (2A.12, Changelog 7/9/11).
                                           Per-environment (Changelog 9): OAuthAppConfig is
                                           unique on (org, provider, sandbox) — sandbox and
                                           production are separate OAuth apps; a legacy
                                           single app falls back for both envs.
POST   /integrations/:provider/connect   → {sandbox?} → returns {authUrl} for OAuth or
                                           accepts {apiKey} for API-key providers. OAuth
                                           400s with {needsOAuthApp:true} if the org hasn't
                                           configured its OAuth app yet. api-key path calls
                                           adapter.verifyCredentials() first and 400s on a
                                           bad key (2A.11); stores into the matching env slot
                                           and reuses an existing connection when the OTHER
                                           environment is added.
GET    /integrations/:provider/callback  → OAuth code exchange (redirect from provider)
                                           stores encrypted credentials, seeds ToolDefinitions
PATCH  /integrations/:connectionId       → update name, sandbox, description, rate limits,
                                           ToolDefinition overrides. Flipping `sandbox` swaps in
                                           that env's stored creds. When the target environment
                                           isn't connected, the switch is now **persisted anyway**
                                           and returns {ok:true, environment, connected:false}
                                           (Changelog 1) — the operator can deliberately observe
                                           the agent against a not-connected environment; the
                                           selection is never auto-reverted to the connected env.
                                           Tool calls then fail gracefully (see graceful-fail below).
POST   /integrations/:connectionId/webhook-endpoint → add/replace ONE environment's
                                           endpoint (URL+method+auth) for an existing
                                           custom webhook; shared tool def/schema.
PATCH  /integrations/:connectionId/webhook-config → full edit of an existing custom
                                           webhook (active env): URL, method, auth
                                           header/value, input JSON schema, tool
                                           name/description. Auth value is a secret —
                                           omit/blank keeps the stored one. Keeps the
                                           ToolDefinition's jsonSchema/name/desc in sync
                                           (2A.4a). Powers the card's "Edit webhook".
PUT    /integrations/:connectionId/paddle-plans → the operator's own plan→price-id map
                                           for their Paddle connection (active env),
                                           stored in the encrypted blob; updates the
                                           up/downgrade tools' targetPlan enum. Integration
                                           Paddle is the OPERATOR's own (their customers'
                                           subs), not platform billing (Changelog 8).
                                           Reads/writes the ACTIVE environment's credential
                                           slot (not the `encryptedCredentials` mirror), so
                                           plans configured in one env are never lost when the
                                           connection is switched to the other — the prior bug
                                           surfaced as "no plans configured" on BOTH upgrade and
                                           downgrade despite a working connection (Changelog 5).
GET    /integrations/:connectionId/paddle-catalog → read-only list of the operator's OWN
                                           active Paddle prices + products (active env),
                                           plus a SUGGESTED plan→price-id mapping grouped by
                                           product (monthly/yearly). The "Configure plans"
                                           step pre-fills from this so operators map their
                                           EXISTING plans in one confirm rather than hand-
                                           typing price ids — which prevents the "no plans
                                           configured" failure. Price/product ids are config,
                                           not secrets (Changelog 5).
PUT    /integrations/:connectionId/webhook-secret → store the signing secret for the
                                           operator's inbound Paddle/Stripe subscription
                                           webhook (active env). Returns the callback URL to
                                           register. Secret verifies every incoming event's
                                           HMAC signature (Changelog 5).
POST   /integrations/paddle/webhook/:connectionId → PUBLIC inbound receiver for the
POST   /integrations/stripe/webhook/:connectionId    operator's OWN Paddle/Stripe account.
                                           No dashboard auth — authenticated by the provider
                                           HMAC signature (verified against the per-connection
                                           webhook secret). Verified subscription-lifecycle
                                           events update an `ExternalSubscription` snapshot so
                                           the assistant reflects out-of-band plan changes and
                                           can answer even during a provider API outage. Distinct
                                           from the platform's own `POST /billing/webhook`
                                           (Changelog 5).
POST   /integrations/:connectionId/verify → re-run the provider's real-connection
                                           check. Body `{sandbox}` selects the env to
                                           test (Changelog 4); it checks THAT env's own
                                           credential slot, not the `encryptedCredentials`
                                           mirror — so a wrong production key no longer
                                           reports success by re-checking the active env.
                                           A selected env with no creds returns
                                           {ok:false, "The <env> environment isn't
                                           connected."}. Refreshes an OAuth token first if
                                           near expiry. Reports {ok, error} inline only —
                                           never mutates the persisted status (2A.11a).
                                           Powers the card's "Test connection" button.
PATCH  /integrations/tools/:toolDefId/guardrails → per-tool guardrail spec (2A.6)
PATCH  /integrations/tools/:toolDefId/registry   → displayName, description, enabledAgentIds
DELETE /integrations/:connectionId       → disconnect. `?environment=sandbox|production`
                                           disconnects JUST that environment (clears its
                                           credential slot; if it was active, promotes the
                                           other) so an operator can drop a per-env account
                                           while keeping the other live (Changelog 6).
                                           Without the param — or when it's the last
                                           connected env — soft-revoke the whole connection
                                           (status:"revoked") AND deactivate its
                                           ToolDefinitions (isActive:false) so a re-added
                                           "exact" connection never resolves to the dead
                                           one (2A.4b).
```

Auth for all routes: `authenticateOperator` middleware (JWT).

### OAuth callback flow

```
1. Operator picks an environment (Sandbox/Production) and clicks "Connect … via OAuth"
2. POST /integrations/calcom/connect {sandbox} → server builds authUrl with
   state=<orgId>.<nonce>.<s|p>  (the env code carries the chosen environment)
3. Operator is redirected to Cal.com authorize screen
4. Cal.com redirects to GET /integrations/calcom/callback?code=...&state=...
5. Server parses orgId + env from state, exchanges code for tokens, encrypts them
6. Server upserts the Connection, storing the tokens in that env's slot
   (sandboxCredentials/productionCredentials) AND encryptedCredentials, sandbox=env
7. Server calls adapter.getTools() → upserts ToolDefinition documents
8. Redirect operator to /app/integrations (dashboard)
```

Connecting the *other* environment later repeats the flow and fills the other slot,
so one OAuth connection can hold both a sandbox and a production token.

### Background token refresh

A recurring job (`apps/api/src/jobs/refreshOAuthTokens.ts`) runs every 15 minutes:
- Queries `Connection` documents where `expiresAt < now + 10min` and `authMode === "oauth"`.
- Calls `adapter.refreshTokens(refreshToken)`.
- Updates `encryptedCredentials` in-place — **and the active environment's slot**
  (`sandboxCredentials`/`productionCredentials`), Changelog 5. Providers like Atlassian
  ROTATE the refresh token on every refresh and invalidate the previous one; if the slot
  keeps the stale token, a later environment switch restores it and the next refresh
  fails with `invalid_grant`, silently killing the connection ("couldn't file a ticket").
  The dispatcher's on-demand refresh (`dispatcher.ts`) does the same.
- Sets `status: "error"` on refresh failure (operator sees a red badge in dashboard).

> **Both environment slots stay fresh (Changelog 5, Option A).** The sweep selects OAuth
> connections whose active token is expiring OR that hold both env slots, and refreshes
> **each** populated slot independently (active mirror + active slot, and the inactive
> slot) — each gated by a per-slot expiry check so tokens aren't rotated needlessly. This
> keeps the inactive environment's token valid so switching sandbox↔production never
> loads a dead, already-rotated token, without needing separate connection documents.

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

**Robustness (Changelog 5).** The adapter surfaces failures as clear, customer-safe,
non-leaky messages instead of raw internals: schema-validation failures name the
offending fields in plain language; `401/403 → "check the connection's auth"`,
`404 → "endpoint not found"`, `5xx → "temporarily unavailable"`; an aborted request
(timeout) becomes "took too long and timed out". A non-JSON / empty `200` body is
tolerated (wrapped as `{ ok: true, message? }`) rather than crashing on `JSON.parse`,
so the model never papers over an opaque error with a hallucinated answer.

**Schema inference at creation (Changelog 5).** Operators frequently paste a *sample*
payload (e.g. `{"orderId":"ORD-12345","reason":"lost"}`) where a JSON Schema is
expected. Rather than storing an unusable value (which renders no inline form and lets
the model guess args), the connect route infers a real object schema from the sample —
each key becomes a required, typed property — via `normalizeWebhookInputSchema()`. A
genuine schema passes through unchanged; a truly unusable value still falls back to an
empty object schema so a bad definition can never 400 the whole tools array.

**Per-agent enablement (Changelog 5).** A newly-created webhook tool starts enabled on
NO agent — the operator explicitly enables it on the agents that should use it, and each
agent only sees (and grounds answers in) the tools enabled for it. Re-adding a previously
revoked webhook (same tool key) still carries its prior enablement forward so the "exact"
re-add works immediately. A defined-but-not-yet-enabled tool won't be offered to that
agent (the model may answer "I don't know") until the operator enables it.

### 2A.4a — Editing an existing webhook

Every detail of a custom webhook is editable after creation via the card's **Edit
webhook** button (`PATCH /integrations/:connectionId/webhook-config`): endpoint URL,
method, auth header, auth value, the input JSON schema, and the tool's display
name/description. The edit targets the **active** environment's endpoint slot and
keeps the linked `ToolDefinition` (`jsonSchema`, `displayName`, `description`) in
sync so the AI immediately sees the change. The auth **value** is a secret the API
never returns — the GET card exposes only `hasAuthValue`; leaving the field blank on
save keeps the stored secret, sending a new value replaces it. Input JSON is only
accepted if it's a genuine object schema (`type:"object"` + `properties`), mirroring
the connect-route guard; anything else keeps the existing schema.

### 2A.4b — Disconnect / reconnect ("exact" re-add)

Webhooks are multi-instance (one Connection per instance), so disconnecting and
re-adding the "same" webhook creates a NEW Connection with a NEW ToolDefinition
sharing the same tool key. To keep the AI routing to the live connection:
- **On revoke** (`DELETE`), the connection's ToolDefinitions are set `isActive:false`
  so they're neither offered to the AI nor resolvable by the dispatcher.
- **On re-add**, the new webhook's ToolDefinition inherits `enabledAgentIds` from the
  most-recent revoked (now-inactive) tool def of the same key, so it works for the
  same agents immediately instead of silently starting disabled.
- **Dispatcher** resolves the tool key by preferring the ToolDefinition whose
  Connection is `active`, so even stale duplicates never surface the
  "connection has been revoked" error.

> **Reconnecting reactivates tools (Changelog 5; hardened 2026-07 batch).** Because revoke
> sets tool defs `isActive:false`, the single-connection providers (OAuth, api-key) must
> **reactivate** them on reconnect. Reactivation lives in `seedConnectionTools()` (shared
> helper): its tool-def upserts put `isActive: true` in `$set` (not `$setOnInsert`, which
> never runs for an existing tool def).
>
> A bug (2026-07 batch) meant the **api-key reconnect** branch of `POST /:provider/connect`
> updated the credentials and returned **before** the seeding loop ran, so reconnecting an
> api-key provider left every tool `isActive:false`. Because `agent.service` only offers
> `isActive:true` tools, the reconnected provider vanished from the tool chain — and when a
> second billing provider was also configured, a subscription query set to the reconnected
> provider as **primary** silently ran against the other provider instead ("no subscription
> found"). Fixed by calling `seedConnectionTools()` on **both** the new-connection and
> reconnect branches (and the OAuth callback), so a reconnect always re-offers the tools.

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

  // upgrade_subscription / downgrade_subscription
  // NOTE: the earlier `planDirection` / `upgradeOnly` (block-downgrades) flag was
  // REMOVED as redundant (Changelog 5) — downgrades are a legitimate self-service action.
  // Changelog 6: `requireBillingOwner` is no longer an operator toggle — it's enforced in
  // code (guardrails.ts ALWAYS_BILLING_OWNER) for subscription + refund tools, and
  // email-OTP identity verification is MANDATORY for subscription-change tools
  // (dispatcher.ts OTP_REQUIRED_TOOLKEYS), regardless of the stored flags below. The
  // field is kept only for backward-compatible reads on other tools.
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

### Dual-environment credentials (per-connection)

A single `Connection` holds BOTH environments' credentials in `sandboxCredentials` /
`productionCredentials`; `encryptedCredentials` mirrors whichever env is active so
the dispatcher/adapters stay unchanged. This applies to **both api-key AND OAuth**
connections. Flow:

- **Connect** stores the credential in the slot for the environment being connected.
  Adding the *other* environment to a provider reuses the existing connection instead
  of creating a duplicate.
  - *api-key*: the connect body's `sandbox` flag picks the slot.
  - *OAuth*: the chosen environment is encoded into the OAuth `state` as
    `<orgId>.<nonce>.<s|p>`; the callback reads the `s|p` code and stores the tokens
    in that slot (legacy states with no code default to production).
- **Switch environment** (PATCH `sandbox`) copies the target env's slot into
  `encryptedCredentials` for api-key and OAuth alike. Connections created before
  per-environment storage are backfilled into their current slot on first switch.
  If the target env has no stored creds, the API returns `{ ok:false, needsSetup:true,
  authMode, environment }`; the dashboard uses `authMode` to prompt correctly — an
  api-key form, or a fresh OAuth redirect for that environment.
- **Dashboard UI**: a `Sandbox | Production` segmented control (always visible, even
  before connecting) lets the operator pick which environment to work with and
  connect *first*. Each segment shows ✓ (has credentials) / ○ (not connected) and the
  selected one is clearly highlighted (accent ring). Selecting a **connected** env
  swaps the active credentials — persisted to the DB (`Connection.sandbox`), the
  single source of truth the dispatcher routes every tool call to (it decrypts that
  env's `encryptedCredentials` slot and passes `connection.sandbox` to
  `adapter.execute`). Selecting an **unconnected** env shows a "Connect {env}" prompt
  (view only; not persisted). New cards default to Sandbox. There is no localStorage
  view-persistence — the DB active environment is authoritative.
- **Disconnect / management** actions (Rename, Guardrails, Rate limits, Tool registry,
  Test connection, Disconnect) render only for an environment that is actually
  connected; a not-connected environment view shows just the connect prompt.
- **Custom webhooks are environment-specific too.** A webhook stores a separate
  sandbox and production endpoint in its slots (only URL/method/auth differ; the tool
  key + input schema are shared). A NEW webhook is created for the selected env (full
  form); adding the OTHER env to an existing webhook uses a compact endpoint form via
  `POST /integrations/:connectionId/webhook-endpoint`. The toggle swaps the active
  endpoint; a missing env returns `needsSetup` with `authMode: "webhook"`.
- The **status badge is per-environment**: green "Connected" only when the environment
  in view has credentials; otherwise amber "{Sandbox|Production} not connected".

### 2A.11a — Credential verification before connect

Provider adapters may implement `verifyCredentials(credentials, sandbox):
Promise<{ok:boolean; error?:string}>`. The api-key connect route calls it and returns
400 with the message instead of marking the connection active, so a bad/wrong-env key
never appears "connected".

**Implemented on every adapter** with a cheap authenticated read:
- Cal.com — `GET /v2/event-types`
- Paddle — `GET /event-types` on the sandbox-vs-live host (surfaces a sandbox key
  used against production)
- Shopify — `GET /admin/api/2024-01/shop.json` (needs the shop domain from `extra.shop`)
- Jira — `GET /oauth/token/accessible-resources` (also confirms the token sees a site)
- Stripe — `GET /v1/account`
- Calendly — `GET /users/me`
- Linear — GraphQL `{ viewer { id } }`

Custom Webhook (2026-07 batch) verifies by calling the endpoint and requiring a **2xx**:
`verifyCredentials` sends the configured **method** (non-GET/HEAD carry a minimal `{}` JSON body) +
auth header to the endpoint URL for the tested environment, with the `WEBHOOK_TIMEOUT_MS` timeout,
after an `assertSafeUrl` SSRF check. **Success only on a 2xx response**; a non-2xx (e.g. a wrong
path → 404, `401/403` auth, `405`, `5xx`) or an unreachable/DNS/TLS/timeout error fails with a
specific reason. This replaced the earlier behavior where the webhook adapter had no
`verifyCredentials` and "Test connection" reported success unconditionally (and an interim
reachability-only probe that still passed a URL answering non-2xx). The probe does invoke the
endpoint, so a test request (POST `{}`) reaches the operator's handler.

**Two call sites:**
1. **Connect gate** — a failed check 400s the connect, so a connection is never created/marked
   active with bad credentials. Applies to the **api-key** path AND (2026-07 batch) the
   **custom-webhook** connect path: `verifyCredentials` runs before `Connection.create`, so a
   webhook whose endpoint is unreachable or doesn't return a 2xx is rejected during
   initialization (the connect form shows the reason) rather than stored and only failing later.
   The webhook **edit** routes are gated the same way (shared `verifyWebhookReachable` helper):
   `POST /:connectionId/webhook-endpoint` (add/replace an environment's endpoint) and
   `PATCH /:connectionId/webhook-config` (full edit) both verify before persisting, so a bad URL
   edit can't repoint a connection at a dead endpoint.
2. **`POST /:connectionId/verify` (manual "Test connection")** — re-checks the
   credentials of the environment named in the body (`{sandbox}`, Changelog 4), reading
   that env's own slot (never the mirror), for ANY connection including OAuth ones that
   never hit the connect gate. A not-connected env returns `{ok:false, "…isn't
   connected."}`. Refreshes a near-expiry OAuth token first. Reports the result inline and
   deliberately does NOT persist status (a transient network blip must not demote a
   working connection).

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
- Meeting: "Business hours" time range + day checkboxes + "Require a real attendee
  name" (defaults **checked** — see 31-agentic-tools 2A.4a/Changelog 1)

### Connector-card actions + modal-close convention

The connected-card action row exposes: Rename, **Edit webhook** (webhooks only —
opens the full edit modal, 2A.4a), Guardrails, Rate limits, Tool registry, Test
connection, Disconnect. Modal-close convention:
- **Single-save modals** (Rename, Rate limits, Edit webhook) close on a successful
  save — Rename/Edit webhook reload to reflect changes; Rate limits shows a brief
  "Saved" then dismisses.
- **Multi-save modals** (Guardrails, Tool registry) have a Save **per row** and stay
  open, so several rows can be saved in one sitting. Each row reports its saved values
  up via `onSaved`, and the card keeps `guardrailOverrides` / `registryOverrides` so
  reopening the modal shows the values just saved — not the stale server-rendered props
  (previously only a full page refresh reflected a save; Changelog 2).

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
