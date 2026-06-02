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

## Out of scope for v1 (deferred)

- Public blog / changelog / about / careers pages
- Multi-language support (i18n) in widget
- Voice / video chat
- Mobile native apps
- Self-serve API keys + public API beyond the embed flow
- SOC2 / ISO compliance paperwork (architecture is compliant; certification is a separate workstream)
