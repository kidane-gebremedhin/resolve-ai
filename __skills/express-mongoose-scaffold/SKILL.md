---
name: express-mongoose-scaffold
description: Scaffold the apps/api Express + TypeScript + Mongoose backend — middleware stack (helmet, CORS, Joi, rate-limit, error handler), MongoDB connection, all 12 Mongoose models with indexes, organization-scoped RLS middleware, and JWT auth. Use during Phase 1 as the first backend skill before any routes are written. Implements __specs/03-data-model.md + __specs/07-api-specification.md + __specs/12-security-compliance.md.
---

# Express + Mongoose Backend Scaffold

## When to use

Phase 1, day one. Lays the foundation that all Phase 1 routes (auth, websites, agents, conversations, messages, contact sessions) extend. Required by [`socketio-realtime`](../socketio-realtime/), [`pinecone-kb-pipeline`](../pinecone-kb-pipeline/), and [`paddle-billing`](../paddle-billing/).

## Prerequisites

- `apps/api/` workspace exists from [`pnpm-turbo-monorepo`](../pnpm-turbo-monorepo/)
- `apps/api/.env` populated per [`__specs/13-env-variables.md`](../../__specs/13-env-variables.md) §"`apps/api/.env`"
- Local MongoDB running via `pnpm dev:infra` ([`19-local-development.md`](../../__specs/19-local-development.md))

## Procedure

1. **Install deps** in `apps/api`: `express`, `mongoose`, `joi`, `helmet`, `cors`, `express-rate-limit`, `winston`, `winston-daily-rotate-file`, `bcryptjs`, `jsonwebtoken`, `dotenv`, `pino`-or-`winston`, `multer` (file upload), `file-type` (MIME validation). Dev: `typescript`, `tsx`, `@types/*`, `jest`, `supertest`.

2. **Folder layout** — exactly as in [`__specs/02-monorepo-structure.md`](../../__specs/02-monorepo-structure.md) §"apps/api". `config/`, `models/`, `routes/`, `controllers/`, `services/`, `middleware/`, `socket/`, `jobs/`, `utils/`, `types/`.

3. **Config**:
   - `config/env.ts` — Joi schema validates `process.env`; throws on startup if any required var is missing (per spec §13 rule "DO NOT SET FALLBACK VALUES IN CODE")
   - `config/db.ts` — Mongoose connection with pool size, retry, `useNewUrlParser` defaults
   - `config/logger.ts` — Winston with daily rotate (`LOG_DIR`, `LOG_MAX_FILES`)
   - `config/pinecone.ts` — Pinecone client init (used by [`pinecone-kb-pipeline`](../pinecone-kb-pipeline/))

4. **Models** — all 12 per [`__specs/03-data-model.md`](../../__specs/03-data-model.md). One file per model under `models/`:
   - `Organization`, `User`, `Membership`
   - `Website`, `Agent`
   - `ContactSession` (TTL index on `expiresAt`)
   - `Conversation`, `Message`
   - `KnowledgeSource`, `WidgetSettings`
   - `Subscription`, `Section`
   - Index lists per model are spelled out in [`__specs/16-production-readiness-audit.md`](../../__specs/16-production-readiness-audit.md) §5.2 — implement every one.

5. **Middleware** (order matters):
   1. `helmet()` — security headers
   2. `cors({ origin: env.CORS_ORIGINS.split(',') })` — strict allowlist, never `*`
   3. `express.json({ limit: '1mb' })` + `express.urlencoded`
   4. `winston` request logger
   5. `express-rate-limit` global (per spec §16 §4.2: 100 req/min per user dashboard, 30 req/min per session widget, 10 req/min IP on auth)
   6. `validation.middleware.ts` — Joi schema runner (per-route schemas)
   7. Route-specific: `auth.middleware.ts` (JWT verify) + `org-context.middleware.ts` (inject `req.orgId` from JWT; reject any body field named `organizationId`)
   8. Routes
   9. `error-handler.middleware.ts` — final, formats errors as `{ error: { code, message, details?, requestId } }` per spec §16 §4.4

6. **JWT auth utility** — sign with `JWT_SECRET`, access TTL 15 min, refresh 7 d (spec §12 §7.1). `bcrypt` cost ≥ 12.

7. **Org-scoped RLS** — **every** query for a tenant-owned resource must include `{ organizationId: req.orgId }`. Provide a `withOrg(query)` helper so devs can't forget. Platform admin routes (`/admin/*`) are the only exception and require `requirePlatformAdmin` middleware.

8. **Routes** (Phase 1 set; Phase 3 + 4 add KB, billing, admin):
   - `auth.routes.ts` — register, login, google, refresh
   - `org.routes.ts` — current org GET/PATCH, members CRUD, invitations
   - `website.routes.ts` — CRUD
   - `agent.routes.ts` — CRUD
   - `widget.routes.ts` — public: `POST /sessions`, `POST /sessions/:id/contact`, `POST /conversations`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages`, `POST /conversations/:id/attachments`, `GET /settings`
   - `conversation.routes.ts` — dashboard: list, detail, status PATCH, assign PATCH
   - `message.routes.ts` — dashboard: list, POST operator message, POST enhance (Phase 3)

9. **Health endpoint** — `GET /health` returns `{ ok, mongo: 'up'|'down', pinecone: 'up'|'down', uptime }` per spec §18 §3.3 (used by Docker healthcheck + Coolify).

10. **No seed script** — the database ships empty per [`__specs/19-local-development.md`](../../__specs/19-local-development.md) §6. Do not generate `apps/api/scripts/seed.ts`; onboard via `POST /auth/register`.

11. **Tests** — Jest + supertest. Integration tests for full auth flow + RLS leakage (spec §16 §4.1). Tests hit a real Mongo (the `services:` block in `ci.yml`), never mocked (per repo convention).

## Gotchas

- **Mongoose `_id` is `ObjectId`** — every cross-reference is `Schema.Types.ObjectId`, populated explicitly only where needed. Don't accidentally compare `String !== ObjectId`.
- **TTL index on `contactSessions.expiresAt`** — Mongo's TTL monitor runs every 60 s, so don't expect immediate expiry; tests must mock or seed `expiresAt: new Date(0)`.
- **`req.body.organizationId`** must be stripped at the validation middleware — passing it through allows org tampering (spec §12 §7.3).
- **bcrypt** is CPU-blocking — use `bcryptjs` (pure JS) if running on Alpine without native deps, accept slight perf hit; or install `bcrypt` with build tools.
- **JSON body limit** — set to 1 MB; file uploads go through `multer` to `/widget/conversations/:id/attachments` only.
- **Joi validation order** — bodies first, then params, then query. Otherwise route-param errors mask body errors.
- **Error response shape is contractual** — frontend depends on `{ error: { code, message } }`. Don't break it accidentally with `res.status(400).send(e.message)`.

## Acceptance

- [ ] `pnpm --filter @csb/api build && pnpm --filter @csb/api start` boots without throwing
- [ ] `GET /health` returns 200 with `mongo: 'up'`
- [ ] All 12 collections show the index sets from spec §16 §5.2 (verify via `mongo-mcp` after `pnpm db:migrate`)
- [ ] Full auth flow integration test green (register → login → JWT → protected route → 401 without token)
- [ ] Multi-org RLS test green (Org A user cannot read Org B conversations)
- [ ] Seed script populates the dataset from spec §19 §6
- [ ] All routes return correct status codes per spec §16 §4.4

## Specs referenced

- [`__specs/03-data-model.md`](../../__specs/03-data-model.md) — all 12 schemas + relationships
- [`__specs/07-api-specification.md`](../../__specs/07-api-specification.md) — every route signature
- [`__specs/12-security-compliance.md`](../../__specs/12-security-compliance.md) — JWT/bcrypt/CORS/rate-limit policy
- [`__specs/16-production-readiness-audit.md`](../../__specs/16-production-readiness-audit.md) §3 + §5 — route tests + schema audit
- [`__specs/13-env-variables.md`](../../__specs/13-env-variables.md) §"`apps/api/.env`" — env catalogue
