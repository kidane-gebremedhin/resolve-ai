# Implementation Master Plan — Overview

> Read the specs first: [`__specs/00-table-of-contents.md`](../__specs/00-table-of-contents.md). This plan tells you **what to do**, in what order; the specs explain **why**.

## How to use

1. Each phase has its own file (`01-phase0-foundation.md` → `05-phase4-billing-polish.md`).
2. Phases are strictly sequential — do not start phase N+1 until phase N's acceptance is green.
3. Each plan calls out the [`__skills/`](../__skills/) skill(s) that encode the procedure for its tasks. Read the skill before executing the task.
4. Verification in each phase points at a subsection of [`__specs/16-production-readiness-audit.md`](../__specs/16-production-readiness-audit.md) — that's the source of truth for "done".

## Phase summary

| # | Plan | Focus | Key deliverables | Spec sources |
|---|------|-------|------------------|--------------|
| 0 | [`01-phase0-foundation.md`](./01-phase0-foundation.md) | Monorepo + template migration + auth + CI + dev env | 4 apps boot via `pnpm dev`; Google sign-in works; `/app/chat` deleted; dev Coolify env live; CI green | 02, 10§Phase0, 11, 13, 17, 18, 19, 21 |
| 1 | [`02-phase1-backend-core.md`](./02-phase1-backend-core.md) | Express API + 12 Mongoose models + auth + CRUD | Full auth flow; conversation/message CRUD; contact sessions with 24h TTL (DB ships empty — no seed) | 03, 07, 10§Phase1, 12 |
| 2 | [`03-phase2-widget-sockets.md`](./03-phase2-widget-sockets.md) | Socket.io + widget iframe + embed loader + AI agent | Customer chats end-to-end with AI responses; embed script works on any HTML page | 04(partial), 05, 08, 09, 10§Phase2 |
| 3 | [`04-phase3-inbox-kb.md`](./04-phase3-inbox-kb.md) | Operator inbox + KB CRUD with Pinecone + Firecrawl + Widget Studio + enhancement LLM | Operators reply in real time; KB syncs to Pinecone; Firecrawl crawls websites | 04, 06, 10§Phase3 |
| 4 | [`05-phase4-billing-polish.md`](./05-phase4-billing-polish.md) | Paddle billing + admin panel + analytics + production deploy | Plan limits enforced; admin panel live; production deployed via Coolify | 10§Phase4, 16, 20 |
| 5 | [`06-widget-polish.md`](./06-widget-polish.md) | **Post-v1.** Modern send icon + sizing, appearance fetched by `agentId`, attachment preview + content extraction | Snippet-free preference updates; AI reads uploaded files | 22 |
| 6 | [`07-admin-and-system-prefs.md`](./07-admin-and-system-prefs.md) | **Post-v1.** Admin Organizations + Agents pages; global app-font system preference | Admin gaps filled; consistent app-wide font | 23 |
| 7 | [`08-paddle-subscriptions.md`](./08-paddle-subscriptions.md) | **Post-v1.** Paddle.js completion: env creds, idempotency, plan catalog, quota coverage, reconcile | Runnable sandbox checkout; hardened billing | 24 |
| 8 | [`09-affiliate-system.md`](./09-affiliate-system.md) | **Post-v1.** Referral attribution + commissions + mailer | Referral funnel + earned commissions + emails | 25 |
| 9 | [`10-conversation-controls.md`](./10-conversation-controls.md) | **Post-v1.** Human-escalation toggle + ask-before-resolve (org settings gate prompt/tools/UI) | Org-configurable conversation behavior | 26 |
| 10 | [`11-kb-crawl-and-phone.md`](./11-kb-crawl-and-phone.md) | **Post-v1.** Same-domain website crawl + favicon avatar; visitor phone country-code from IP | Scoped crawls + auto avatar; geo-defaulted phone code | 27, 28 |
| 12 | [`12-usd-usage-tracking.md`](./12-usd-usage-tracking.md) | **Post-v1.** USD cost capture from OpenRouter, per-plan budget caps, 402 enforcement, email alerts at 75%/100%, usage dashboard with cost charts | UsageRecord + BudgetAlert models; budget middleware; admin Budget & Limits UI | — |
| 13 | [`13-tier1-widget-polish.md`](./13-tier1-widget-polish.md) | **Tier 1.** Streaming SSE tokens · Markdown rendering · KB citations · 👍/👎 feedback · CSAT star picker · Quick-reply chips | Streaming AI replies; react-markdown; Citations component; MessageFeedback + ConversationRating models; QuickReplies component | 29 |
| 14 | [`14-integration-framework.md`](./14-integration-framework.md) | **Tier 2A.** AES-256-GCM credential vault · OAuth framework · ProviderAdapter interface · Tool dispatcher with guardrails + rate limit + audit log · OTP identity verification · Integrations dashboard tab | Connection + ToolDefinition + ToolCallLog models; crypto.service.ts; dispatcher.ts; assertSafeUrl(); integrations routes; Integrations nav item | 30 |
| 15 | [`15-agentic-tools.md`](./15-agentic-tools.md) | **Tier 2B.** Cal.com + Calendly booking · Paddle subscription mgmt · Stripe refunds · Linear + Jira ticket creation · Knowledge-gap logging | 6 provider adapters; KnowledgeGap model; analytics knowledge-gap card | 31 |
| 16 | [`16-rich-messages.md`](./16-rich-messages.md) | **Tier 3.** Message blocks system · Card + carousel · Inline forms · Image vision · OG link previews | MessageBlock union type; blocks field on Message; BlockRenderer component tree; resultToBlocks() in dispatcher; OG preview service | 32 |
| 17 ✅ | [`17-proactive-lifecycle.md`](./17-proactive-lifecycle.md) | **Tier 4.** Typing indicators (bidirectional) · Proactive trigger rules · Launcher unread badge · Triggers management UI | Operator/customer typing socket events; ProactiveTrigger model; embed trigger evaluation; csb:unread badge | 33 |
| 18 ✅ | [`18-trust-compliance-voice.md`](./18-trust-compliance-voice.md) | **Tiers 5–6.** PII redaction · Audit trail UI · Transcript export · Data residency stub · Widget rate limiting + abuse detection · Browser-mic voice · Twilio phone bridge | piiMask extensions; widgetRateLimit middleware; ToolCallLog audit UI; S3 transcript export; stt.service + tts.service; voice routes; Twilio WebSocket handler | 34 |

| 19 ✅ | [`19-error-monitoring-sentry.md`](./19-error-monitoring-sentry.md) | **Ops.** Sentry SDKs for the API and web app · `/sentry-example-page` production smoke test · build-arg + Coolify wiring | instrument.ts (API, first import); setupExpressErrorHandler; debug.routes.ts; instrumentation-client.ts; sentry.{server,edge}.config.ts; global-error.tsx; withSentryConfig | 35 |
| 20 | [`20-langgraph-refactor.md`](./20-langgraph-refactor.md) | **Architecture.** Replace the hand-rolled agent with a LangGraph `StateGraph` · LangChain tools/retriever/embeddings · LCEL side chains · single chat-model factory over OpenRouter · optional LangSmith tracing | `services/ai/{llm,retrieval,tools,graph,chains,shared}`; agent/tools/finalize nodes; input gate; engine facade; graph + gate + controls tests | 05, 13 |

> **Post-v1 phases (5–12)** are independent enhancement tracks from the product backlog, not strictly sequential like Phases 0–4. Phase 8 (affiliate) benefits from Phase 7 (plan catalog) landing first.
>
> **Tier phases (13–18)** are the ROADMAP.md feature tiers. They are ordered: 13 → 14 → 15 (spine required before tools); 13 → 16 (Markdown renderer needed for block fallback); 17 is independent after 13; 18 requires 14 for piiMask.ts reuse. Tiers 5–6 (Phase 18) are post-launch hardening.

## Skill ↔ phase invocation map

| Skill | Source | Used in phases |
|-------|--------|---------------|
| [`pnpm-turbo-monorepo`](../__skills/pnpm-turbo-monorepo/) | Written | 0 |
| [`nextjs16-template-migration`](../__skills/nextjs16-template-migration/) | Written | 0 |
| [`shadcn-ui-package`](../__skills/shadcn-ui-package/) | Written | 0 |
| [`nextauth-google-credentials`](../__skills/nextauth-google-credentials/) | Written | 0 |
| [`docker-multi-stage-apps`](../__skills/docker-multi-stage-apps/) | Written | 0 |
| [`github-actions-monorepo`](../__skills/github-actions-monorepo/) | Written | 0 |
| [`coolify-three-env-deploy`](../__skills/coolify-three-env-deploy/) | Written | 0 (dev), 4 (prod) |
| [`mcp-builder`](../__skills/mcp-builder/) | Downloaded | 0 (`.mcp.json` authoring), any future MCP work |
| [`express-mongoose-scaffold`](../__skills/express-mongoose-scaffold/) | Written | 1 |
| [`socketio-realtime`](../__skills/socketio-realtime/) | Written | 2 |
| [`widget-embed-iframe`](../__skills/widget-embed-iframe/) | Written | 2 |
| [`pinecone-kb-pipeline`](../__skills/pinecone-kb-pipeline/) | Written | 3 |
| [`firecrawl-website-ingestion`](../__skills/firecrawl-website-ingestion/) | Written | 3 |
| [`paddle-billing`](../__skills/paddle-billing/) | Written | 4 |
| [`webapp-testing`](../__skills/webapp-testing/) | Downloaded | All (Verification step in every phase) |
| [`skill-creator`](../__skills/skill-creator/) | Downloaded | Ongoing (when authoring new skills) |

## Critical dependencies (cannot skip)

```
Phase 0
├── pnpm-turbo-monorepo            (everything else depends on the workspace)
├── shadcn-ui-package              (template-migration depends on @csb/ui)
├── nextjs16-template-migration    (delete /app/chat; deletes mock data)
├── nextauth-google-credentials    (dashboard + admin guards)
├── docker-multi-stage-apps        (CI needs working Dockerfiles)
├── github-actions-monorepo        (must be green to merge)
├── coolify-three-env-deploy(dev)  (first live remote env)
└── mcp-builder                    (.mcp.json + future MCP)
        ↓
Phase 1
└── express-mongoose-scaffold      (all backend models + auth)
        ↓
Phase 2
├── socketio-realtime              (needs Express + JWT)
└── widget-embed-iframe            (needs Socket.io + widget API)
        ↓
Phase 3
├── pinecone-kb-pipeline           (needs file storage + embedding API)
└── firecrawl-website-ingestion    (bridges Firecrawl → pinecone-kb-pipeline)
        ↓
Phase 4
├── paddle-billing                 (last — needs features to gate)
└── coolify-three-env-deploy(prod) (prod brought up only after billing tested)
```

## Cross-cutting rules (apply in every phase)

These are repeated in [`__specs/00-table-of-contents.md`](../__specs/00-table-of-contents.md) §"Constraints" but worth highlighting at the top of each phase:

- **No `/app/chat`** — the inbox is the operator chat UI. Removed in Phase 0 and verified in every phase's audit.
- **Organization-level RLS on every query** — server-side enforced via JWT-derived `req.orgId`. Never accept `organizationId` from the body.
- **Email is not a conversation identifier** — `contactSessionId` is.
- **Per [`AGENTS.md`](../AGENTS.md)**: Next.js 16 + React 19 — verify any framework API against `node_modules/next/dist/docs/` before writing it.
- **CI builds; Coolify runs** — never deploy locally-built images to remote envs.
- **Secrets distinct per environment** — leaked dev secret must not unlock staging/prod.
- **Mandatory MCPs in QA** — `chrome-devtools-mcp`, `mongo-mcp`, `paddle-mcp` per [`__specs/16-production-readiness-audit.md`](../__specs/16-production-readiness-audit.md). Full server roster: [`__specs/21-mcp-tooling.md`](../__specs/21-mcp-tooling.md).

## Phase entry/exit gates

Every phase must satisfy these before moving on:

| Gate | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|------|---------|---------|---------|---------|---------|
| `pnpm build` green | ✅ | ✅ | ✅ | ✅ | ✅ |
| `pnpm type-check` green | ✅ | ✅ | ✅ | ✅ | ✅ |
| `pnpm test` green (unit+integration) | n/a | ✅ | ✅ | ✅ | ✅ |
| CI workflow green on the merge branch | ✅ | ✅ | ✅ | ✅ | ✅ |
| §16 audit subsection for the phase | n/a | §3.1-3.6 | §2.5 + §4.3 | §3.7 + §2.4 | §6 + full |
| Dev Coolify environment renders the change | ✅ | ✅ | ✅ | ✅ | ✅ |
| `mongo-mcp` confirms data integrity | n/a | ✅ | ✅ | ✅ | ✅ |
| `chrome-devtools-mcp` finds zero console errors on touched pages | n/a | n/a | ✅ | ✅ | ✅ |

## Tier 1–6 critical dependencies

```
Phase 13 (Tier 1 — Widget Polish)
├── Streaming AI loop (message:delta / message:done)
├── Markdown renderer — required by Phase 16 (block fallback)
└── CSAT + Feedback models
        ↓
Phase 14 (Tier 2A — Integration Framework)
├── crypto.service.ts (AES-256-GCM vault)
├── assertSafeUrl() — reused by Phase 16 (OG preview)
├── piiMask.ts — reused by Phase 18 (LLM preprocessing)
└── dispatcher.ts — required by Phase 15 (tool adapters)
        ↓
Phase 15 (Tier 2B — Agentic Tools)   Phase 16 (Tier 3 — Rich Messages)
└── 6 provider adapters               └── resultToBlocks() (needs dispatcher)

Phase 17 (Tier 4 — Proactive)        Phase 18 (Tiers 5–6 — Trust+Voice)
└── (independent after Phase 13)      └── (independent after Phase 14)
```

## Out of scope for v1 (deferred)

- Public blog / changelog / about / careers pages
- Multi-language support (i18n) in widget
- Voice / video chat (shipped in Phase 18 post-launch)
- Mobile native apps
- Self-serve API keys + public API beyond the embed flow
- SOC2 / ISO compliance paperwork (architecture is compliant; certification is a separate workstream)
- Multi-region data residency routing (deferred per BLOCKERS.md B-3 Option C)
