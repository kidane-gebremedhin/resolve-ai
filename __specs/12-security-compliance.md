# 12 — Security & Compliance Checklist

## Overview

This document enumerates every security control required across the platform. All items must be verified before production launch. Organized by layer: network → application → data → monitoring.

---

## 1. Organization-Level RLS (Row-Level Security)

| # | Requirement | Implementation | Priority |
|---|-------------|---------------|----------|
| 1.1 | Every Mongoose query includes `organizationId` | `org-context.middleware.ts` injects `req.orgId` from JWT on all `/api/v1/*` protected routes | 🔴 Critical |
| 1.2 | Never accept `organizationId` from request body | Middleware must always override with JWT-derived value | 🔴 Critical |
| 1.3 | Pinecone namespace = `organizationId` | Enforced in `embedding.service.ts`; no default/fallback namespace ever | 🔴 Critical |
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
| 2.6 | Google OAuth validation | Verify `id_token` with Google's public keys, check `aud` matches client ID |
| 2.7 | Role hierarchy enforcement | `owner > admin > agent > viewer`, enforced by `requireOrgRole(min)` (`apps/api/src/middleware/org-role.middleware.ts`), method-aware (reads open to all members, writes require the rank). **admin+**: websites, agents, widget-settings, sections, triggers, integrations, billing, `PATCH /orgs/current`. **agent+** (blocks viewer): knowledge, conversations, messages. Member-management is admin+ (`assertCanManageMembers`); `DELETE /orgs/current` is owner-only (Changelog 2). |
| 2.8 | Token refresh flow | Only valid (non-expired) refresh tokens accepted; old refresh token invalidated on use |
| 2.9 | Auth endpoint rate limiting | `express-rate-limit` per client IP (trusted proxy): `/auth/login` 10 / 15 min (successful logins exempt), `/auth/forgot-password` 5 / hour (anti inbox-bombing), `POST /public/contact` 5 / hour (Changelog 2). |
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

---

## 7. Socket.io Security

| # | Control | Implementation |
|---|---------|---------------|
| 7.1 | Authentication on connect | Dashboard: JWT verified on `connection` event; Widget: session token verified |
| 7.2 | Room authorization | User can only join rooms for their org's conversations |
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
