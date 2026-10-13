# 12 — Security & Compliance Checklist

## Overview

This document enumerates every security control required across the platform. All items must be verified before production launch. Organized by layer: network → application → data → monitoring.

---

## 1. Organization-Level RLS (Row-Level Security)

| # | Requirement | Implementation | Priority |
|---|-------------|---------------|----------|
| 1.1 | Every Mongoose query includes `organizationId` | `org-context.middleware.ts` injects `req.orgId` from JWT on all `/api/v1/*` protected routes | 🔴 Critical |
| 1.2 | Never accept `organizationId` from request body | Middleware must always override with JWT-derived value | 🔴 Critical |
| 1.3 | Vector-store isolation | **Metadata filtering, not namespaces.** Every query is AND-scoped on `organizationId` **and** `agentId` (`services/kb/search.service.ts`), and a query arriving without an `agentId` is **refused** rather than widened to the whole org. Asserted by `vector-tenancy.test.ts`. Per-org Pinecone namespaces remain the stronger design and are recorded as future hardening in [`04-pinecone-firecrawl.md`](04-pinecone-firecrawl.md) — they require migrating existing vectors, which is why they have not shipped. This row previously claimed namespaces were enforced; they never were | 🔴 Critical |
| 1.4 | KB operations scoped to org | Upload, edit, read, list, delete, search — all filtered by `organizationId` | 🔴 Critical |
| 1.5 | Widget session tied to org | `contactSessions.organizationId` set on creation, verified on every message | 🔴 Critical |
| 1.6 | Cross-org conversation access impossible | `GET /conversations/:id` must verify conversation belongs to requesting user's org | 🔴 Critical |
| 1.7 | Multi-org test in CI | Integration test creates 2 orgs and verifies zero data leakage | 🔴 Critical |

---

## 2. Authentication & Authorization

### Operator Authentication (NextAuth + JWT)

| # | Control | Detail |
|---|---------|--------|
| 2.1 | JWT secret strength | Minimum 256-bit random secret stored in `JWT_SECRET` env var; rotate quarterly |
| 2.2 | JWT expiration | Access token: 15 minutes; Refresh token: 7 days |
| 2.3 | JWT algorithm | `HS256` (HMAC-SHA256) minimum; `RS256` recommended for multi-service |
| 2.4 | Password hashing | bcrypt with cost factor ≥ 12 (`bcrypt.hash(password, 12)`) |
| 2.5 | Password policy | Min 8 chars + ≥1 lowercase, ≥1 uppercase, ≥1 number, ≥1 special char. Enforced **server-side** by the shared `strongPassword` Zod schema in `apps/api/src/routes/auth.routes.ts` (backs `register` + `reset-password`), matching the signup UI. `login` accepts any non-empty string (Changelog 2). |
| 2.6 | Google OAuth validation | **Implemented** (`apps/api/src/services/security/google-id-token.ts`). `POST /auth/google` verifies the id_token's RS256 signature against Google's JWKS (cached, refetched on unknown `kid`), issuer `accounts.google.com`, `aud` in `GOOGLE_CLIENT_ID` (comma list), expiry, and requires `email_verified`. Identity comes only from the token; body `email`/`name` are ignored. An existing account with 2FA must use password + code (`403`). An existing account whose email was never verified is treated as possibly pre-registered by someone else: its password is cleared and its sessions revoked before linking. Previously the endpoint trusted the body email, which allowed takeover of any account. |
| 2.6a | Token types | Every JWT carries `typ` (`access`/`refresh`), signed and verified as HS256 only. Access tokens are refused at `/auth/refresh`; refresh tokens are refused as Bearer tokens and on sockets. Untyped legacy tokens are refused. |
| 2.6b | Session revocation | `User.tokenVersion` is embedded in every token as `tv` and compared on every request, refresh and socket handshake. Bumped by `POST /auth/logout` (all devices; called from NextAuth `signOut`), password reset, a member's role/status change or removal, and Google claiming an unverified account. 2FA enable/disable does not bump it (the dashboard cannot swap its own tokens mid-flow); use logout to end other sessions. |
| 2.6c | Email verification | Registration emails a 24h link (`/verify-email`). Not required to log in (default); it gates SSO linking (2.6) and invite acceptance. Password reset also verifies the address and, for an unverified account, clears 2FA. |
| 2.7c | Member changes | `PATCH`/`DELETE /orgs/current/members/:id` refuse a target at or above the caller's rank (owners may act on other owners), only owners grant `owner`, and the org must keep one active owner (applies to role and status). A `pending` invite becomes active only via `POST /orgs/invites/accept` (hashed, single-use, 7-day token). |
| 2.7 | Role hierarchy enforcement | `owner > admin > agent > viewer`, enforced by `requireOrgRole(min)` (`apps/api/src/middleware/org-role.middleware.ts`), method-aware (reads open to all members, writes require the rank). **admin+**: websites, agents, widget-settings, sections, triggers, integrations, billing, `PATCH /orgs/current`. **agent+** (blocks viewer): knowledge, conversations, messages. Member-management is admin+ (`assertCanManageMembers`); `DELETE /orgs/current` is owner-only (Changelog 2). |
| 2.8 | Token refresh flow | Only valid (non-expired) refresh tokens accepted; old refresh token invalidated on use |
| 2.9 | Auth endpoint rate limiting | `express-rate-limit` per client IP (trusted proxy): `/auth/login` 10 / 15 min (successful logins exempt), `/auth/forgot-password` 5 / hour (anti inbox-bombing), `/auth/register` `AUTH_REGISTER_RATE_LIMIT_MAX` / hour, `/auth/google` 30 / 15 min, invite preview/accept 20 / 15 min, `POST /public/contact` 5 / hour (Changelog 2). All limiters use `MongoRateStore` (`ratecounters`), so limits hold across API replicas. |
| 2.9a | SSO first-login org provisioning | Google sign-in for a new email MUST create an `Organization` + owner `Membership` before issuing the access token. Without this the JWT carries no `organizationId` and every `/api/v1/*` call 403s with `No organization context in token`. Implemented in `apps/api/src/services/auth.service.ts:ensureMembershipForUser`. |
| 2.9b | Client auto-logout on stale token | Browser-side `clientApiFetch` catches `401 + "Invalid or expired access token" / "Missing or malformed Authorization header"`, calls `signOut({ redirect: false })`, and redirects to `/login?session=expired&from=<path>`. Server-side `apiFetch` still throws so RSC pages can render their own fallback. |
| 2.7a | `membershipRole` in the operator session | `/auth/login` and `/auth/google` return **two** roles: `role` (platform: `user` \| `platform_admin`) and `membershipRole` (org rank, 2.7). NextAuth (`apps/web/src/lib/auth.ts`) MUST persist both onto the JWT and session — they are distinct fields and must never be collapsed. Previously only `role` was carried, so the dashboard had no idea of the org rank and offered owner-only actions to agents/viewers, which then 403'd on click (Changelog 4). |
| 2.7b | UI mirrors the role guards | `apps/web/src/lib/permissions.ts` maps each write capability to the minimum role its API route requires, and `useCan()` / `<ReadOnlyNotice>` hide or disable the corresponding controls. This is **defence in depth for UX only** — the API guard in 2.7 remains the sole enforcement point, and hiding a button grants nothing. Reads stay visible to every member, mirroring the middleware's safe-method pass-through. When a `requireOrgRole` changes on the API, update the capability map in the same change (Changelog 4). |
| 2.9c | Silent access-token rotation | NextAuth `jwt` callback (`apps/web/src/lib/auth.ts`) persists the refresh token issued by `/auth/login`+`/auth/google` and calls `POST /auth/refresh` ~1 min before the 15m access token expires, writing the new token back to the session cookie (via the `/api/session-token` route handler). This keeps the 7d session live without the user hitting 2.9b mid-session; 2.9b now only fires once the **refresh** token (7d) expires or refresh fails. |

### Widget Session Authentication

| # | Control | Detail |
|---|---------|--------|
| 2.10 | Session token format | UUID v4 (opaque), stored in `contactSessions.token` |
| 2.11 | Session header | `X-Session-Token` on all widget API calls |
| 2.12 | Session TTL | 24 hours (sliding window recommended); enforced by MongoDB TTL index |
| 2.13 | Expired session behavior | Return `401` → widget creates new session → fresh conversation |
| 2.14 | No email-based session lookup | Session token is the ONLY identity mechanism; email is CRM-only metadata |
| 2.15 | Session binding | Session bound to `organizationId + websiteId` at creation; cannot be reused across orgs |
| 2.16 | Anonymous creation limits | Per-IP limits on new sessions (`WIDGET_SESSIONS_PER_IP`) and attachment uploads (`WIDGET_ATTACHMENTS_PER_IP`); per-session limit on messages, proactive greetings, voice messages, uploads and OTP checks |
| 2.17 | Identity-bound integration tools | See spec 30 "Identity binding". Account-scoped tools always act on the session's verified email; arguments cannot redirect them. OTP codes live in MongoDB, are hashed, session-bound, and burned after 5 wrong attempts. |
| 2.18 | Visitor-authored content | `/widget/conversations/:id/proactive` takes only a `triggerId`; the greeting text comes from the saved trigger, so a visitor cannot write `role: "ai"` messages. |
| 2.19 | Token in URLs | Attachment links carry `?t=<sessionToken>`; it is redacted from morgan access logs and Sentry events. |

---

## 3. Network & Transport Security

| # | Control | Implementation |
|---|---------|---------------|
| 3.1 | HTTPS everywhere | TLS 1.2+ required; HTTP → HTTPS redirect in production |
| 3.2 | Helmet middleware | `helmet()` applied to all Express routes (sets X-Content-Type-Options, X-Frame-Options, etc.) |
| 3.3 | CORS configuration | `cors({ origin: allowedOrigins })` per website; default deny |
| 3.4 | Widget iframe CORS | Widget origin validated against `websites.allowedOrigins` per request |
| 3.5 | Socket.io CORS | Same origin validation as REST API |
| 3.6 | Rate limiting (dashboard) | 100 req/min per user (via `express-rate-limit`) |
| 3.7 | Rate limiting (widget) | 30 req/min per session token |
| 3.8 | Rate limiting (auth) | 10 req/min per IP on `/auth/login` and `/auth/register` |
| 3.9 | Rate limiting (AI) | Per-org daily cap based on subscription plan |
| 3.10 | CSP headers | `Content-Security-Policy` restricts script sources, frame ancestors |

---

## 4. Input Validation & Sanitization

| # | Control | Implementation |
|---|---------|---------------|
| 4.1 | Joi validation on all routes | Every request body/query validated via Joi schemas before reaching controller |
| 4.2 | File upload MIME allowlist | `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/csv`, `image/png`, `image/jpeg`, `image/webp`, `text/html` |
| 4.3 | File upload size limits | Widget: 10 MB per file; KB upload: plan-dependent (5–100 MB) |
| 4.4 | File type verification | Validate MIME type via magic bytes (not just `Content-Type` header) — use `file-type` npm package |
| 4.5 | Filename sanitization | Strip path traversal (`../`), special chars; generate UUID-based storage names |
| 4.6 | Message content sanitization | Sanitize HTML in message `content` before storage; allow Markdown |
| 4.7 | SQL/NoSQL injection prevention | Mongoose parameterized queries only; never construct queries from string concatenation |
| 4.8 | XSS prevention | Sanitize all user-provided content rendered in dashboard (DOMPurify on frontend) |
| 4.9 | URL validation (Firecrawl) | Validate URL format; block internal/private IP ranges (`10.*`, `192.168.*`, `127.*`, `169.254.*`) for SSRF prevention |
| 4.10 | Max field lengths | Enforce via Joi: name (100), email (255), message content (10,000 chars), title (200) |

---

## 5. API Key & Secret Management

| # | Control | Implementation |
|---|---------|---------------|
| 5.1 | No secrets in client bundles | Pinecone API key, OpenAI/OpenRouter key, Paddle API key — server-side only (`apps/api/.env`) |
| 5.2 | Environment variable isolation | Each app has its own `.env`; `apps/web` uses `NEXT_PUBLIC_` prefix only for truly public values |
| 5.3 | `.env` in `.gitignore` | All `.env*` files (except `.env.example`) excluded from version control |
| 5.4 | Secret rotation plan | Document rotation procedure for: JWT secret, API keys, Paddle webhook secret |
| 5.5 | Paddle webhook verification | Verify `Paddle-Signature` header using Paddle's public key; reject unverified webhooks |
| 5.6 | No API keys in logs | Winston formatters must redact any field matching `/key|secret|token|password/i` |

---

## 6. Data Protection

| # | Control | Implementation |
|---|---------|---------------|
| 6.1 | Passwords never stored in cleartext | bcrypt only; `passwordHash` field; never log password values |
| 6.2 | PII minimization | Contact sessions store only: name, email, phone, IP (first-seen), user agent |
| 6.3 | Data retention policy | Expired contact sessions auto-deleted via TTL index; conversations retained per org plan |
| 6.4 | Encryption at rest | MongoDB Atlas: encryption at rest enabled (AES-256); Pinecone: managed encryption |
| 6.5 | Backup strategy | MongoDB: daily automated backups with 30-day retention |
| 6.6 | File storage security | S3 bucket: private ACL, pre-signed URLs with 1-hour expiry for access |
| 6.7 | Organization data deletion | When org is deleted: cascade delete all collections, purge Pinecone namespace, delete S3 files |
| 6.8 | Per-turn telemetry retention | `toolcalllogs` and `ragturnmetrics` carry TTL indexes on `createdAt` — 90 days, `ragturnmetrics` configurable via `RAG_TELEMETRY_RETENTION_DAYS`. Analytics that outlive their usefulness are a liability, not an asset |
| 6.9 | Telemetry PII masking | Query text and judge claim strings written to `ragturnmetrics` pass through `services/integrations/piiMask.ts` **before** persisting, **unconditionally** — independent of the org's `piiRedaction` setting, which governs only what reaches the model. Asserted in `rag-telemetry.test.ts` against a fixture carrying an email address and a card number |

---

## 7. Socket.io Security

| # | Control | Implementation |
|---|---------|---------------|
| 7.1 | Authentication on connect | Dashboard: JWT verified on `connection` event; Widget: session token verified |
| 7.2 | Room authorization | User can only join rooms for their org's conversations. Widget visitors never join `org:{orgId}` (internal alerts and all-conversation events); they get only `contact:{sessionId}` (spec 08). Operator handshakes check token type, `tokenVersion`, user existence and active membership. |
| 7.3 | Room name unpredictability | Room format: `conversation:{conversationId}` — ObjectId provides sufficient entropy |
| 7.4 | Message validation | All Socket.io payloads validated before broadcast |
| 7.5 | Connection limits | Max 10 connections per user; 3 connections per session token |
| 7.6 | Disconnect cleanup | Remove from all rooms on disconnect; clean heartbeat timers |

---

## 8. Dependency Security

| # | Control | Implementation |
|---|---------|---------------|
| 8.1 | Dependency auditing | `pnpm audit` in CI pipeline; fail build on critical/high vulnerabilities |
| 8.2 | Lock file integrity | Commit `pnpm-lock.yaml`; verify integrity in CI |
| 8.3 | No wildcard versions | Pin major.minor versions in `package.json` (e.g., `^5.0.0` not `*`) |
| 8.4 | Automated updates | Dependabot or Renovate configured for weekly security patches |
| 8.5 | License compliance | No GPL-3.0 dependencies in production bundle (MIT/Apache-2.0/ISC only) |

---

## 9. Logging & Monitoring

| # | Control | Implementation |
|---|---------|---------------|
| 9.1 | Structured logging | Winston with JSON format; fields: `timestamp`, `level`, `message`, `requestId`, `userId`, `orgId` |
| 9.2 | Request correlation | UUID `requestId` generated per request via middleware; propagated to all logs |
| 9.3 | Audit trail | Log: auth events (login/logout/register), role changes, KB CRUD, billing events |
| 9.4 | Error tracking | Unhandled exceptions logged with full stack trace; integrate Sentry for this.
| 9.5 | Log rotation | Winston `daily-rotate-file`: max 14 days, max 20 MB per file, gzip archives |
| 9.6 | No PII in logs | Redact email, phone, tokens, passwords from log output |
| 9.7 | Health check endpoint | `GET /health` returns `200` with DB/Redis/Pinecone connectivity status |
| 9.8 | Uptime monitoring | External ping on `/health` every 60s; alert on 3 consecutive failures |

---

## 10. Compliance Considerations

| Area | Requirement | Implementation |
|------|-------------|---------------|
| **GDPR** | Right to erasure | API endpoint to delete all user/contact data per request |
| **GDPR** | Data export | API endpoint to export conversation history as JSON for a contact session |
| **GDPR** | Cookie consent | Widget does not set cookies (uses localStorage); if cookies added, banner required |
| **GDPR** | Privacy policy link | Widget footer links to operator's privacy policy URL (configurable in widget settings) |
| **SOC 2** | Access controls | Role-based access, audit logging, encrypted storage |
| **PCI DSS** | No card data storage | Paddle handles all payment data; no card numbers touch our servers |

---

## Pre-Launch Security Checklist

```
[ ] All RLS middleware verified with multi-org integration tests
[ ] Helmet enabled with production CSP headers
[ ] CORS locked to specific origins (no wildcard in production)
[ ] Rate limiting configured and tested on all route groups
[ ] File upload MIME validation via magic bytes (not Content-Type alone)
[ ] JWT secret is ≥256-bit random; refresh tokens implemented
[ ] bcrypt cost factor ≥ 12 on all password hashes
[ ] No API keys or secrets in client bundles (verified in build output)
[ ] Paddle webhook signature verification enabled
[ ] Winston log redaction for PII fields confirmed
[ ] pnpm audit shows zero critical/high vulnerabilities
[ ] SSRF protection on Firecrawl URL input
[ ] Socket.io auth middleware prevents unauthorized room joins
[ ] Session TTL (24h) verified with expired-token test
[ ] Org deletion cascades all data including Pinecone namespace
[ ] .env.example contains all required variables with placeholder values
```


---

## Webhook authentication (Twilio)

`POST /api/v1/voice/twiml` is public by necessity — Twilio posts to it directly — so its
`X-Twilio-Signature` check **is** its authentication. Implemented in
`middleware/twilio-signature.middleware.ts` using Twilio's HMAC-SHA1 scheme (URL + form params
sorted by key, base64 digest), compared timing-safely.

It fails closed: with `TWILIO_AUTH_TOKEN` unset the endpoint returns `503` rather than serving an
unauthenticated webhook. Twilio posts `application/x-www-form-urlencoded`, so that router mounts
`express.urlencoded()` — without it the signed parameters never reach `req.body` and no signature
can be verified.

`GET /voice/status` requires authentication: it discloses the org's provisioned phone number.

## Secrets at rest

Third-party integration credentials use the AES-256-GCM vault (`services/security/crypto.service.ts`).
Single-string secret fields on documents that predate the vault go through
`services/security/secret-field.ts`:

- `sealSecret(value)` — encrypt, serialised to JSON in the existing String field.
- `openSecret(stored)` — decrypt, **passing legacy plaintext through unchanged** so the change
  deploys with no migration; values re-seal on their next write.

Applied to `User.totpSecret` and `PlatformSetting.smtp.secret`. The SMTP password is never returned
by the API — `GET /admin/settings` sends a `smtpSecretSet` boolean instead, and an empty submitted
value means "leave unchanged".

## Two-factor authentication

Enforced in `loginWithCredentials()` (`services/auth.service.ts`), not in the route, so every client
is gated by construction:

| Situation | Response |
|---|---|
| 2FA off | Tokens issued on email + password |
| 2FA on, no code | `401` `totp_required` |
| 2FA on, wrong code | `401` `invalid_totp` |
| 2FA on, valid TOTP or recovery code | Tokens issued |

`POST /auth/login` accepts an optional `code`, so accounts without 2FA still authenticate in one
round trip.

**Clock-skew tolerance (Changelog 16).** TOTP verification accepts codes from the
adjacent 30-second windows as well as the current one, via `verifyTotp()` in
`services/security/totp.ts`. Every TOTP check goes through that helper rather
than calling `otplib.verify` directly, because the tolerance is a
security-relevant decision and a call site that quietly omitted it would be a
login bug nobody notices until users complain.

Verifying against only the current window — otplib's default, and what this
codebase did until it was found — rejects a code whenever the user's device
clock has drifted a second or two, the code was typed near a window boundary, or
the request spent a moment in a proxy. Users read all three as "my authenticator
is wrong", retry, and hit the login rate limit. RFC 6238 §5.2 calls for adjacent
steps to be accepted for exactly this reason.

The widening is one step, not more: 3 codes in 1,000,000 are valid at any
instant instead of 1. Against `loginLimiter` (10 attempts per 15 minutes, with
`skipSuccessfulRequests`) that moves a guess from negligible to negligible,
while the cost it removes — locking out users with slightly wrong clocks — is
real and continuous. A code two windows old is still rejected, asserted.

**Ordering matters:** the `totp_required` signal is only reachable *after* the password is verified.
Emitting it earlier would turn the endpoint into an oracle that confirms which addresses are
registered. A test asserts a wrong password returns the generic error even for a 2FA account.

**Recovery codes are one-time.** Stored as bcrypt hashes and removed from the user document as part
of the login that consumes them — a code that worked twice would be a permanent password bypass.

They are drawn from an alphabet with no `-`/`_` (which would collide with the group separators) and
no `0/o` or `1/l/i`, because they are transcribed by hand during a lockout.

**A wrong code is a 400, not a 401**, on `/2fa/verify` and `/2fa/disable`: the caller's session is
valid and only the submitted code was wrong. Returning 401 tripped the dashboard's "401 means the
session is dead" rule and signed the operator out mid-setup. Clients should treat the `totp_required`
and `invalid_totp` codes as caller-handled, never as a reason to end the session.

Clients (`apps/web`, `apps/admin`) surface `totp_required` / `invalid_totp` through their NextAuth
credentials provider by throwing a `CredentialsSignin` subclass whose `code` reaches the form, which
then reveals the code field.

## Reverse proxies and client IP

`TRUST_PROXY` (default `1`) sets Express's `trust proxy`. It decides how much of `X-Forwarded-For`
is believed when computing `req.ip`, which every IP-keyed rate limit depends on.

**Never set it to `true`.** That trusts the entire forwarded chain, so any client can present an
arbitrary source IP and bypass the login throttle, the contact-form limit and the coupon
brute-force throttle. express-rate-limit rejects the configuration outright
(`ERR_ERL_PERMISSIVE_TRUST_PROXY`). Use the number of proxy hops actually in front of the API, or a
comma-separated list of trusted proxy IPs/CIDRs.

## Rate limiting and IPv6

Custom `keyGenerator`s must wrap the client IP in `ipKeyGenerator()` (express-rate-limit), which
normalises IPv6 to its /64 prefix. Keying on raw `req.ip` lets a client rotate addresses within
their own allocation and bypass the limit entirely — and express-rate-limit v8 rejects it outright
(`ERR_ERL_KEY_GEN_IPV6`).

## Outbound requests (SSRF)

Every server-side fetch to a URL a tenant or visitor can influence (custom webhooks, link
previews, the widget section proxy) goes through `safeFetch` in
`apps/api/src/services/integrations/ssrf.ts`. It resolves DNS inside the socket's own
`lookup`, so the address checked is the address connected to (no rebinding window). It
blocks loopback, private, link-local, CGNAT, multicast, reserved and documentation ranges
for IPv4 and IPv6, including `0.0.0.0/8`, IPv4-mapped/compatible, NAT64 and 6to4 forms.
Redirects are followed by hand (max 3) and every hop is re-validated. Bodies are capped.
Webhooks remain HTTPS-only; the section proxy allows HTTP but returns only `text/html`,
under a CSP `sandbox` without `allow-same-origin`.

## Uploaded files

Attachments are served with `nosniff`. Only raster images (`png`, `jpeg`, `gif`, `webp`,
`avif`, `bmp`) are `inline`; everything else, SVG and HTML included, is
`Content-Disposition: attachment`, so an upload can never render as a page on the API
origin.

## Webhook replay

Paddle (platform and per-connection) and Stripe signatures are rejected when the signed
timestamp is more than 300 seconds from now, in addition to `event_id` idempotency.

## Debug endpoints

`/api/v1/debug-sentry` is unauthenticated and throws deliberately. Gated behind
`DEBUG_ENDPOINTS_ENABLED`, which defaults to **off in production**. A disabled deployment returns a
plain `404`.
