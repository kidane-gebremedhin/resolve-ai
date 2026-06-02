# Phase 4 — Billing, Admin, Analytics, Polish, Production

## Goal

Paddle billing is integrated end-to-end: checkout → webhook → subscription record → plan-limit enforcement. The platform admin panel (`/admin/*`) is wired to real data. Analytics show accurate conversation + resolution numbers. Audio notifications work in widget + dashboard. The production Coolify environment is live behind TLS and receives its first deploy.

## Prerequisites

- Phase 3 green (operator inbox, KB, Widget Studio working)
- Paddle account with sandbox + production credentials
- 4 Paddle products + prices created (Free / Starter / Pro / Enterprise) with IDs in env vars
- Production VPS provisioned for Coolify production node
- MongoDB Atlas M10+ cluster created; `MONGODB_URI` `mongodb+srv://...` ready for prod env
- SES / Resend / Postmark account for production SMTP

## Skills to invoke

- [[__skills/paddle-billing]] — checkout, webhooks, plan limits (steps 1–4)
- [[__skills/coolify-three-env-deploy]] — production project + DNS + TLS + secrets (step 9)
- [[__skills/socketio-realtime]] (Phase 2) — Redis adapter if scaling `api` past 1 replica (step 9)
- [[__skills/webapp-testing]] (downloaded) — final end-to-end audit
- [[__skills/mcp-builder]] (downloaded) — `paddle-mcp` invocation reference during verification

## Work breakdown (ordered)

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | Paddle SDK integration (server + client overlay) | `apps/api/src/services/billing.service.ts`, `apps/web/src/lib/paddle.ts` | `paddle-billing` | Paddle.js loads in `/app/billing`; SDK initialized |
| 2 | Webhook handler with signature verification + idempotency + all event types | `apps/api/src/routes/billing.routes.ts`, `apps/api/src/services/billing.service.ts` | `paddle-billing` | Spec §16 §6.3 + §6.6 |
| 3 | Plan-limit middleware (AI msg/month, KB sources, Firecrawl pages) | `apps/api/src/middleware/plan-limit.middleware.ts`, integrated in widget message + KB + Firecrawl routes | `paddle-billing` | Free 101st AI msg auto-escalates; Free 21st KB source rejected with 402 |
| 4 | `/app/billing` wired (current plan tile, usage meters, checkout, upgrade, portal); `/app/usage` wired (usage meters) | `apps/web/src/app/(dashboard)/app/billing/page.tsx`, `apps/web/src/app/(dashboard)/app/usage/page.tsx` | `paddle-billing` | Spec §16 §6.7 |
| 5 | Admin routes: `/admin/stats`, `/admin/users`, `/admin/subscribers`, `/admin/subscriptions`, `/admin/analytics`, `/admin/settings` | `apps/api/src/routes/admin.routes.ts`, `apps/api/src/middleware/admin.middleware.ts` (`requirePlatformAdmin`), `apps/web/src/app/(admin)/admin/*` (wire template pages) | (extends `express-mongoose-scaffold`) | Non-admin user → 404; admin sees cross-org data; spec §16 §3.10 |
| 6 | Analytics routes + `/app/analytics` wired (overview cards, conversation-over-time chart, resolution rate, top KB queries) | `apps/api/src/routes/analytics.routes.ts`, `apps/web/src/app/(dashboard)/app/analytics/page.tsx` | (extends `express-mongoose-scaffold`) | Spec §16 §3.11 + §2.4 |
| 7 | Audio notifications + TTS options | `apps/widget/src/lib/audio.ts`, `apps/web/src/lib/audio.ts`, user preferences in `/app/settings`, `apps/api/src/services/ai/tts.service.ts` (provider-pluggable: OpenAI TTS, ElevenLabs, browser SpeechSynthesis) | (no skill — direct implementation) | Spec §10 Phase 4 audio acceptance |
| 8 | Session cleanup cron job (backup for TTL index) | `apps/api/src/jobs/session-cleanup.job.ts` | (extends `express-mongoose-scaffold`) | Job runs in dev; expired sessions removed |
| 9 | Stand up `csb-production` Coolify project; production DNS for `app.customer-service-chatbot.app`, `widget.customer-service-chatbot.app`, `api.customer-service-chatbot.app`, `embed.customer-service-chatbot.app`; TLS; Atlas connection string; backups; observability sinks | `coolify/docker-compose.production.yml` (committed), Coolify UI, DNS panel, MongoDB Atlas, Sentry/Grafana | `coolify-three-env-deploy` | All 4 services healthy in prod; backups configured; spec §20 §11 checklist green |
| 10 | Wire `deploy-production.yml` manual approval flow; smoke-deploy a no-op commit | `.github/workflows/deploy-production.yml` already exists from Phase 0; just exercise it | `github-actions-monorepo` (existing) | Deploy completes; `https://app.customer-service-chatbot.app/health` returns 200; rollback tested |
| 11 | Landing page polish (final copy pass, demo widget embedded on `/`, SEO meta tags, OG image) | `apps/web/src/app/(marketing)/page.tsx`, `apps/web/src/components/marketing/sections/Hero.tsx` (add demo widget embed) | (no skill) | Spec §10 Phase 4 landing acceptance |
| 12 | Final security review pass — run [`/security-review`](../__specs/16-production-readiness-audit.md) §7 against branch | spec §16 §7 | (no skill; mandatory checklist) | All boxes checked |

## Verification

- [ ] Paddle sandbox: dashboard → click Pro → Paddle overlay → test card → success → `mongo-mcp` confirms `Subscription` row + `organizations.plan: 'pro'`
- [ ] Repeat with webhook replay (same eventId twice) → single DB write (idempotency)
- [ ] Free plan: send 101 AI messages → 101st auto-escalates (verify `confidence` and `status: 'escalated'`)
- [ ] Free plan: create 21st KB source → 402 with `code: 'PLAN_LIMIT'`
- [ ] Upgrade Free → Pro → limits increase immediately
- [ ] Cancel subscription → status canceled but features active until period end
- [ ] Customer portal link from `/app/billing` opens working Paddle portal
- [ ] Admin sign-in (user with `role: 'platform_admin'`) → `/admin` loads with cross-org data
- [ ] Non-admin sign-in → `/admin` returns 404 (not 403)
- [ ] Analytics `/app/analytics`: numbers match a manual `mongo-mcp` aggregation
- [ ] Audio: new message sound plays in dashboard inbox + widget composer; can be muted in settings
- [ ] TTS: AI reply read aloud in widget when enabled
- [ ] Production: `https://app.customer-service-chatbot.app` loads with TLS, sign in with Google works, can start a widget conversation
- [ ] `paddle-mcp`: production subscription matches `mongo-mcp` `Subscription` rows
- [ ] [`__specs/16-production-readiness-audit.md`](../__specs/16-production-readiness-audit.md) **entire** audit green (all sections)
- [ ] Backup restore drill: spin up a copy of staging from yesterday's Atlas snapshot, smoke-test sign-in + chat
- [ ] Rollback drill: re-run `deploy-production.yml` with N-1 SHA → traffic served from old containers within 2 min
- [ ] [`webapp-testing`](../__skills/webapp-testing/) full regression suite green across web + widget + admin

## Out of scope (deferred to post-v1)

- Multi-language widget (i18n)
- Voice / video chat
- Native mobile apps
- Self-serve public API for embed customization
- SOC2 / ISO 27001 audit
- Per-PR preview environments (configured in CI but optional — see spec §18 §2.5)
