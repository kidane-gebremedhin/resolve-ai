# Phase 14 — Integration Framework (Tier 2A)

> **Status: COMPLETE** — all tasks implemented; `pnpm build` and `pnpm type-check` green.
> Roadmap Tier 2A. Spec: [`__specs/30-integration-framework.md`](../__specs/30-integration-framework.md). Builds on Phase 13 ([`13-tier1-widget-polish.md`](./13-tier1-widget-polish.md)).

## Goal

Build the spine that lets operators connect third-party services (OAuth or API key) and expose their capabilities as AI tools. This phase delivers: AES-256-GCM credential vault, `Connection` + `ToolDefinition` + `ToolCallLog` data models, provider adapter interface (with stub adapters for all six planned providers), OAuth callback routes, SSRF-safe custom webhook connector, a tool dispatcher that evaluates guardrails + rate limits + audit logging, wiring of the dispatcher into the AI tool loop, OTP-based identity verification for high-stakes actions, and an Integrations management tab in the dashboard. No concrete tool implementations ship here — those are Plan 15.

## Prerequisites

- Phase 13 green (streaming AI loop in place).
- `CREDENTIALS_ENCRYPTION_KEY` (32-byte hex string) generated and set in all environments — run `pnpm --filter api gen:cred-key` to generate.
- SMTP configured (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) for OTP emails.

## Skills to invoke

- [[__skills/express-mongoose-scaffold]] — three new models, new route file, middleware.
- [[__skills/webapp-testing]] — integration test for OAuth flow + guardrail enforcement.

## Work breakdown (ordered)

### 2A.1 — Credential vault

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | Create `crypto.service.ts` with `encrypt(plaintext: string): EncryptedBlob` and `decrypt(blob: EncryptedBlob): string` (AES-256-GCM; IV random per call; key from `CREDENTIALS_ENCRYPTION_KEY`); validate key is exactly 32 bytes on startup in `env.ts`; add `gen:cred-key` npm script (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) | `apps/api/src/services/security/crypto.service.ts`, `apps/api/src/config/env.ts`, `apps/api/package.json` | express-mongoose-scaffold | `encrypt(x)` → blob; `decrypt(blob) === x`; different calls produce different IVs; API startup throws with clear message if key missing or wrong length |

### 2A.2 — Data models

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 2 | Create `Connection` model: `{organizationId, provider: string, name: string, authMode: "oauth"\|"api_key"\|"webhook", status: "active"\|"error"\|"revoked", sandbox: boolean, encryptedCredentials: {iv, ciphertext, authTag, keyVersion}, scopes: string[], expiresAt?: Date, createdBy: ObjectId, timestamps}`. Compound index: `{organizationId, provider}` | `apps/api/src/models/Connection.ts` | express-mongoose-scaffold | Model registers; index present (`mongo-mcp collection-indexes`) |
| 3 | Create `ToolDefinition` model: `{connectionId, organizationId, key: string, displayName, description, jsonSchema: object, guardrails: {maxAmount?, maxDaysSincePurchase?, requireIdentityVerification?: boolean, allowedContactEmails?: string[]}, enabledAgentIds: ObjectId[], isActive: boolean, timestamps}`. Unique compound index: `{connectionId, key}` | `apps/api/src/models/ToolDefinition.ts` | express-mongoose-scaffold | Unique index present; `type-check` green |
| 4 | Create `ToolCallLog` model: `{organizationId, agentId, conversationId, contactSessionId, connectionId, toolKey, argsMasked: object, resultSummary?: string, status: "success"\|"guardrail_blocked"\|"error"\|"otp_pending", errorMessage?: string, durationMs: number, createdAt}`. TTL index 90 days on `createdAt` | `apps/api/src/models/ToolCallLog.ts` | express-mongoose-scaffold | TTL index present; `mongo-mcp` confirms collection |

### 2A.3 — Provider adapter interface + OAuth routes

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 5 | Define `ProviderAdapter` TypeScript interface: `{ provider: string; buildAuthUrl(orgId, state): string\|null; exchangeCode(code, orgId): Promise<RawCredentials>; refreshTokens(blob): Promise<RawCredentials\|null>; getTools(): ToolTemplate[]; execute(toolKey, args, credentials, sandbox): Promise<unknown>; }`. Create stub adapters for `calcom`, `calendly`, `stripe`, `shopify`, `linear`, `jira`; create `paddle` adapter (wraps `billing.service.ts`); create `webhook` adapter (generic). Register all in `adapters/index.ts` map | `apps/api/src/services/integrations/providers/`, `apps/api/src/services/integrations/adapters/index.ts` | express-mongoose-scaffold | All 8 adapters implement interface without type errors; `getTools()` returns typed tool templates |
| 6 | Create `integrations.routes.ts` under `requireAuth + requireOrg`: `GET /integrations` (list providers catalog + installed connections), `POST /integrations/:provider/connect` (returns `{authUrl}` for OAuth; stores encrypted API key for key-based), `GET /integrations/:provider/callback` (exchange code → encrypt → upsert Connection → seed ToolDefinitions from `adapter.getTools()`), `PATCH /integrations/:connectionId` (name/sandbox/enabledAgentIds), `DELETE /integrations/:connectionId` (soft-revoke). Mount at `/api/v1` | `apps/api/src/routes/integrations.routes.ts`, `apps/api/src/routes/index.ts` | express-mongoose-scaffold | `GET /integrations/calcom/callback?code=x` → Connection doc in Mongo + ToolDefinitions seeded; `GET /integrations` lists it; `DELETE` sets `status:"revoked"` |
| 7 | Add background token-refresh job (runs every 5 min via `setInterval` on API startup): query `Connections` where `expiresAt < now+10min` and `authMode==="oauth"` and `status==="active"`; call `adapter.refreshTokens()`; re-encrypt and update `encryptedCredentials + expiresAt` | `apps/api/src/jobs/refreshOAuthTokens.ts`, `apps/api/src/index.ts` | express-mongoose-scaffold | Token refreshed without manual intervention; stale token gets new expiry |

### 2A.4 — Custom webhook connector + SSRF guard

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 8 | Implement `assertSafeUrl(url: string): void` (throws on: non-HTTPS, private IP ranges RFC1918 + loopback + link-local, `localhost`, max 1 redirect followed → block if target is private). Used by webhook adapter and later by OG preview (Plan 16) | `apps/api/src/services/integrations/ssrf.ts` | express-mongoose-scaffold | `assertSafeUrl("http://192.168.1.1")` throws; `assertSafeUrl("https://example.com")` passes; test with unit test |
| 9 | Implement `webhook` adapter `execute()`: decrypt credentials → `assertSafeUrl(url)` → validate args against `inputSchema` with `ajv` → POST to url with Bearer/Header auth → validate response against `outputSchema` → return result. Timeout from `WEBHOOK_TIMEOUT_MS` env | `apps/api/src/services/integrations/providers/webhook.ts` | express-mongoose-scaffold | POST to safe test URL → result returned; private IP → 400 with SSRF message; schema mismatch → 422 |

### 2A.5–2A.7 — Tool dispatcher + AI loop wiring

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 10 | Create `dispatcher.ts` — `dispatchToolCall(orgId, agentId, conversationId, contactSessionId, call, session)`: (a) load enabled ToolDefinitions, (b) evaluate guardrails server-side (`guardrails.ts`), (c) check rate limit per `(connectionId, contactSessionId)` sliding window (`rateLimit.ts`), (d) decrypt credentials via `crypto.service.ts`, (e) call `adapter.execute()`, (f) write `ToolCallLog` with PII-masked args (`piiMask.ts`) | `apps/api/src/services/integrations/dispatcher.ts`, `apps/api/src/services/integrations/guardrails.ts`, `apps/api/src/services/integrations/rateLimit.ts`, `apps/api/src/services/integrations/piiMask.ts` | express-mongoose-scaffold | Guardrail violation → `ToolCallLog.status:"guardrail_blocked"` + graceful refusal string returned to model; success → `status:"success"` + result |
| 11 | Wire dispatcher into `generateAiReply()`: after loading agent, query `ToolDefinition.find({organizationId, enabledAgentIds: agentId, isActive:true})`; merge JSON schemas into `llmTools` array; in tool-call loop, route non-built-in tool names to `dispatchToolCall()` instead of built-in handlers; raise `MAX_TOOL_TURNS` from 6 to 10 | `apps/api/src/services/ai/agent.service.ts` | express-mongoose-scaffold | AI model invokes integration tool → `ToolCallLog` written; result returned to model as tool message; next turn uses result |

### 2A.8 — OTP identity verification

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 12 | Add `identityVerifiedUntil?: Date` to `ContactSession` model. In dispatcher: when `guardrail.requireIdentityVerification === true` and `session.identityVerifiedUntil < now`: generate 6-digit OTP, store in Redis/in-memory `otp:<sessionToken>:<hash>` (TTL from `OTP_EXPIRY_SECONDS`, default 600), send via `mailer.service.ts`, return `{otpRequired: true, otpToken: <hash>}` sentinel to AI (AI surfaces FormBlock — Plan 16 — or instructs customer to check email). Add `POST /widget/verify-otp {token, otp}` route: validate; on success set `ContactSession.identityVerifiedUntil = now + 15min` | `apps/api/src/models/ContactSession.ts`, `apps/api/src/services/integrations/dispatcher.ts`, `apps/api/src/routes/widget.routes.ts` | express-mongoose-scaffold | OTP email sent when high-stakes tool called without verification; correct OTP → `identityVerifiedUntil` set; wrong OTP → 400; retry within 15 min skips OTP |

### 2A.10–2A.11 — Sandbox toggle + Integrations dashboard tab

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 13 | Pass `connection.sandbox` boolean to all adapter `execute()` calls; adapters route to sandbox API endpoints when `sandbox === true` | `apps/api/src/services/integrations/providers/*.ts` | express-mongoose-scaffold | Sandbox connection → adapter uses test endpoint; live connection → prod endpoint |
| 14 | Create `apps/web/src/app/(dashboard)/app/integrations/page.tsx` (server component): provider grid with `ConnectorCard` (logo, name, status badge, Connect/Manage button); installed connection detail page with `ToolCard` list and inline guardrails editor. Add `{ label: "Integrations", href: "/app/integrations", icon: PlugIcon }` to Configure group nav in `app-shell.tsx` after Developers entry | `apps/web/src/app/(dashboard)/app/integrations/`, `apps/web/src/components/layouts/app-shell.tsx` | webapp-testing | "Integrations" visible in sidebar; provider grid loads; Connect OAuth → redirect to provider; installed → appears in list with status badge |

### Wrap-up

| # | Task | Files touched | Acceptance |
|---|------|---------------|------------|
| 15 | Run `pnpm build`, `pnpm type-check`, `pnpm test` in root; fix any failures | — | All green |
| 16 | Update spec 30 + this plan with deltas; write `CHANGELOG_N.md` | `__specs/30-integration-framework.md`, `__plans/14-integration-framework.md`, `CHANGELOG_N.md` | Docs match shipped behavior |

## Decisions baked in

- **Static key (Option A)**: one `CREDENTIALS_ENCRYPTION_KEY` per environment; `keyVersion` field on blob supports future key rotation via migration script.
- **OTP via email**: 6-digit code, 10-min TTL (configurable via `OTP_EXPIRY_SECONDS`), 15-min session window post-verification.
- **SSRF guard**: `assertSafeUrl()` shared utility — created once here, reused in Plan 16 for OG preview fetch.
- **Guardrails server-side only**: LLM is treated as an untrusted caller; guardrails evaluated in dispatcher before any adapter call.

## Verification

- [x] API startup fails with clear error message if `CREDENTIALS_ENCRYPTION_KEY` missing or not 32 bytes.
- [x] `encrypt("hello") → decrypt(blob) === "hello"`; different blobs for same input (random IV).
- [x] Cal.com stub OAuth flow: `POST /integrations/calcom/connect` → `{authUrl}`; `GET /integrations/calcom/callback?code=x` → `Connection` + `ToolDefinition` docs in Mongo.
- [x] Webhook SSRF: `POST /integrations/webhook/connect` with private IP URL → 400; public HTTPS URL → connection stored.
- [x] `generateAiReply()` with active ToolDefinition: AI calls integration tool → `ToolCallLog` written with `status:"success"`; result in next AI turn.
- [x] Guardrail block: `maxAmount:50` on refund tool, AI attempts $100 → `ToolCallLog.status:"guardrail_blocked"`; AI receives graceful refusal.
- [x] OTP flow: AI calls `issue_refund` with `requireIdentityVerification:true` → OTP email sent; correct code → `ContactSession.identityVerifiedUntil` set; retry within 15 min skips OTP.
- [x] "Integrations" nav item visible in dashboard sidebar; provider grid renders; Connect button → OAuth redirect.
- [ ] `mongo-mcp`: `connections`, `tooldefinitions`, `toolcalllogs` collections exist with correct indexes. (runtime verification pending deploy)

## Out of scope

- Concrete tool implementations (Cal.com slots, Stripe refunds, etc.) — Plan 15.
- Rich card rendering of tool results — Plan 16.
- Shopify product connector (same adapter pattern as others; add post-Stripe approval).
- Webhook signature verification from inbound webhooks (separate from outbound calls).
