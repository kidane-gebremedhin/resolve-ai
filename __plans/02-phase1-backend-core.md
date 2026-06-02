# Phase 1 — Backend Core

## Goal

`apps/api` is a working Express server with all 12 Mongoose models, full auth flow (register / login / refresh / google), contact-session lifecycle with 24 h TTL, conversation + message CRUD. Multi-org RLS is enforced and tested. The database ships empty — there is no seed script; onboard via the register flow. Zero frontend changes — this phase exists below the UI.

## Prerequisites

- Phase 0 acceptance green (workspace, Docker, CI, dev Coolify)
- Local Mongo + Redis running via `pnpm dev:infra`
- `apps/api/.env` filled per [`__specs/13-env-variables.md`](../__specs/13-env-variables.md) §"`apps/api/.env`"
- Mongoose collection-create permissions on local Mongo (auto via `scripts/mongo-init.js`)

## Skills to invoke

- [[__skills/express-mongoose-scaffold]] — the central skill for the entire phase
- [[__skills/webapp-testing]] (downloaded) — phase verification (REST flow via Playwright APIs or supertest)
- [[__skills/mcp-builder]] (downloaded) — reference if any service needs a custom MCP

## Work breakdown (ordered)

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | Express bootstrap with full middleware stack (helmet, cors, json, winston, rate-limit, joi, error-handler) | `apps/api/src/index.ts`, `apps/api/src/middleware/*.ts`, `apps/api/src/config/{env,db,logger,pinecone,redis}.ts` | `express-mongoose-scaffold` | `GET /health` returns 200 with mongo+pinecone status |
| 2 | All 12 Mongoose models with indexes per spec §03 + §16 §5.2 | `apps/api/src/models/{Organization,User,Membership,Website,Agent,ContactSession,Conversation,Message,KnowledgeSource,WidgetSettings,Subscription,Section}.ts` | `express-mongoose-scaffold` | `mongo-mcp` confirms all 12 collections + all indexes from §16 §5.2 |
| 3 | Auth routes + JWT util + bcrypt | `apps/api/src/routes/auth.routes.ts`, `apps/api/src/controllers/auth.controller.ts`, `apps/api/src/services/auth.service.ts`, `apps/api/src/utils/jwt.ts` | `express-mongoose-scaffold` | `POST /auth/register` creates user+org+membership (verify `mongo-mcp`); `POST /auth/login` returns JWT; `POST /auth/refresh` rotates; **`POST /auth/google` first-login auto-provisions `Organization` + owner `Membership` via `auth.service.ts:ensureMembershipForUser()`** so the issued JWT carries `organizationId` — without this `requireOrg` returns `403 No organization context in token` on every subsequent call |
| 4 | `auth.middleware.ts` (JWT verify) + `org-context.middleware.ts` (inject `req.orgId`, reject `body.organizationId`) | `apps/api/src/middleware/{auth,org-context}.middleware.ts` | `express-mongoose-scaffold` | Protected route without token → 401; token from Org A cannot read Org B data |
| 5 | Organization routes (current GET/PATCH, members CRUD, invitations) | `apps/api/src/routes/org.routes.ts`, controllers, services | `express-mongoose-scaffold` | Role transitions per spec §16 §3.2 |
| 6 | Website routes (CRUD) | `apps/api/src/routes/website.routes.ts` | `express-mongoose-scaffold` | Spec §16 §3.3 acceptance |
| 7 | Agent routes (CRUD) — per-agent system prompt + confidence threshold | `apps/api/src/routes/agent.routes.ts` | `express-mongoose-scaffold` | Spec §16 §3.4 |
| 8 | Contact-session routes + `widget-auth.middleware.ts` (session-token validation, TTL check) | `apps/api/src/routes/widget.routes.ts` (sessions+contact endpoints), `apps/api/src/middleware/widget-auth.middleware.ts` | `express-mongoose-scaffold` | `POST /widget/sessions` returns token; expired token rejected; spec §16 §3.8 |
| 9 | Conversation routes (list, detail, status PATCH, assign PATCH) | `apps/api/src/routes/conversation.routes.ts` | `express-mongoose-scaffold` | Status transitions enforced; spec §16 §3.5 |
| 10 | Message routes (GET thread, POST operator, POST widget — minus AI agent which is Phase 2) | `apps/api/src/routes/message.routes.ts`, `apps/api/src/routes/widget.routes.ts` (message endpoints) | `express-mongoose-scaffold` | Cursor pagination; org-scoped; spec §16 §3.6 |
| 11 | No seed script — the DB ships empty; onboard via `POST /auth/register` per spec §19 §6 | — | — | A fresh DB has zero documents; registering creates the first org + user |
| 12 | Jest + supertest integration tests for full auth + RLS + conversation flow | `apps/api/tests/{auth,rls,conversation}.test.ts`, `apps/api/jest.config.ts` | `express-mongoose-scaffold` | CI `test` job green |

## Verification

- [ ] `pnpm --filter @csb/api start` boots in <5 s; `/health` returns `{ ok: true, mongo: 'up' }`
- [ ] `pnpm --filter @csb/api test` green — covers register/login/refresh/google, RLS leakage, conversation status transitions
- [ ] `mongo-mcp`: list indexes on every collection; cross-check against spec §16 §5.2
- [ ] `mongo-mcp`: confirm TTL index on `contactSessions.expiresAt`
- [ ] Manual: register Org A user, register Org B user, attempt to fetch Org A conversation from Org B token → 404
- [ ] [`webapp-testing`](../__skills/webapp-testing/): run a Python Playwright script that hits the API directly via `httpx` (Playwright isn't needed for REST but the skill's harness setup is reusable for Phase 2)
- [ ] [`__specs/16-production-readiness-audit.md`](../__specs/16-production-readiness-audit.md) §3.1–§3.6 + §4.1 + §4.4 + §5 — all checklists green for implemented routes
- [ ] CI green on the `dev` branch after merge
- [ ] Dev Coolify env's `api` container redeploys + `/health` returns 200

## Out of scope (defer to later phase)

- Socket.io (Phase 2)
- AI agent / `agent.service.ts` invocation from message route (Phase 2)
- KB routes (Phase 3)
- Message enhancement endpoint (Phase 3)
- Billing routes (Phase 4)
- Admin routes (Phase 4)
- Analytics routes (Phase 4)
- File uploads (`POST /widget/conversations/:id/attachments`) — stub the route, implement upload in Phase 2 alongside the widget composer
