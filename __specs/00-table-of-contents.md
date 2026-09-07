# Implementation Master Plan — Table of Contents

> **Product**: Customer Service Chatbot — Multi-tenant AI Customer Support SaaS
> **Date**: 2026-05-22
> **Status**: Draft v1.0

---

## Overview

This specification describes the complete implementation plan for a production-ready, multi-tenant AI customer-support SaaS platform. The system is composed of **three distinct products** sharing one API and one org-tenancy model:

| # | Component | Users | Surface |
|---|-----------|-------|---------|
| 1 | **Chat Widget** | End customers on a website | `apps/widget` (iframe) + `apps/embed` (loader script) |
| 2 | **Operator Dashboard** | Support agents / org members | `apps/web` (`/app/*` routes) |
| 3 | **Developer Toolkit** | Developers embedding the widget | `apps/web` (`/developers`) + `apps/embed` |

---

## Spec Files

| # | File | Section |
|---|------|---------|
| 01 | [01-executive-summary.md](./01-executive-summary.md) | Executive Summary |
| 02 | [02-monorepo-structure.md](./02-monorepo-structure.md) | Recommended Monorepo Structure |
| 03 | [03-data-model.md](./03-data-model.md) | Data Model (MongoDB) |
| 04 | [04-pinecone-firecrawl.md](./04-pinecone-firecrawl.md) | Pinecone & Firecrawl Design |
| 05 | [05-ai-agent-design.md](./05-ai-agent-design.md) | Shared AI Agent Design |
| 06 | [06-operator-enhancement-llm.md](./06-operator-enhancement-llm.md) | Operator Enhancement LLM |
| 07 | [07-api-specification.md](./07-api-specification.md) | API Specification |
| 08 | [08-socketio-design.md](./08-socketio-design.md) | Socket.io Design |
| 09 | [09-widget-state-machine.md](./09-widget-state-machine.md) | Widget State Machine |
| 10 | [10-frontend-phases.md](./10-frontend-phases.md) | Frontend Implementation Phases (0–4) |
| 11 | [11-page-wiremap.md](./11-page-wiremap.md) | Page-by-Page Wire-up Map |
| 12 | [12-security-compliance.md](./12-security-compliance.md) | Security & Compliance Checklist |
| 13 | [13-env-variables.md](./13-env-variables.md) | Environment Variables Master List |
| 14 | [14-testing-strategy.md](./14-testing-strategy.md) | Testing Strategy |
| 15 | [15-risks-decisions.md](./15-risks-decisions.md) | Risks, Decisions & Open Questions |
| 16 | [16-production-readiness-audit.md](./16-production-readiness-audit.md) | Production Readiness Audit (MCP-Driven) |
| 17 | [17-template-asset-inventory.md](./17-template-asset-inventory.md) | Template Asset Inventory & Migration Map |
| 18 | [18-cicd-pipeline.md](./18-cicd-pipeline.md) | CI/CD Pipeline (GitHub Actions → GHCR → Coolify) |
| 19 | [19-local-development.md](./19-local-development.md) | Local Development Environment |
| 20 | [20-coolify-deployment.md](./20-coolify-deployment.md) | Coolify Deployment |
| 21 | [21-mcp-tooling.md](./21-mcp-tooling.md) | MCP Tooling (`.mcp.json`) |

### Post-v1 enhancement specs

| # | File | Section | Backlog item |
|---|------|---------|--------------|
| 22 | [22-widget-enhancements.md](./22-widget-enhancements.md) | Widget Enhancements (send icon, appearance-by-agentId, attachment preview + extraction) | #5, #6, #7 |
| 23 | [23-admin-and-system-preferences.md](./23-admin-and-system-preferences.md) | Admin Panel Completion & Global System Preferences (font) | #1, #2 |
| 24 | [24-paddle-subscriptions.md](./24-paddle-subscriptions.md) | Paddle.js Subscription System — Completion & Hardening | #4 |
| 25 | [25-affiliate-system.md](./25-affiliate-system.md) | Affiliate / Referral System (+ Mailer) | #3 |
| 26 | [26-conversation-controls.md](./26-conversation-controls.md) | Conversation Resolution Consent & Human-Escalation Toggle | #9, #10 |
| 27 | [27-website-kb-crawl-favicon.md](./27-website-kb-crawl-favicon.md) | Website KB Full-Crawl & Favicon-as-Avatar | #11 |
| 28 | [28-phone-country-code.md](./28-phone-country-code.md) | Visitor Phone Country-Code from IP | #8 |

### Roadmap specs (Tiers 1–6)

> These specs derive from `ROADMAP.md` (see repo root). Implement in tier order.

| # | File | Section | Tier |
|---|------|---------|------|
| 29 | [29-tier1-widget-polish.md](./29-tier1-widget-polish.md) | Streaming responses · Markdown · Citations · Inline feedback · CSAT · Quick-reply chips | Tier 1 — Table stakes |
| 30 | [30-integration-framework.md](./30-integration-framework.md) | Credential vault · OAuth flows · Tool registry · Guardrails · Audit log · Integrations tab | Tier 2A — Integration spine |
| 31 | [31-agentic-tools.md](./31-agentic-tools.md) | Calendar booking · Subscription mgmt · Refunds · Order lookup · Ticket creation · Knowledge-gap logging | Tier 2B — Agentic tools |
| 32 | [32-rich-messages.md](./32-rich-messages.md) | Message blocks system · Card/carousel · Inline forms · Image vision · Link previews | Tier 3 — Rich messages |
| 33 | [33-proactive-lifecycle.md](./33-proactive-lifecycle.md) | Proactive triggers · Typing indicators · Read receipts · Launcher unread badge | Tier 4 — Proactive & lifecycle |
| 34 | [34-trust-compliance-voice.md](./34-trust-compliance-voice.md) | PII redaction · Audit trail · Transcript export · Data residency · Rate limiting · Browser voice · Phone bridge | Tiers 5–6 — Trust, compliance & voice |

### Operations specs

| # | File | Section |
|---|------|---------|
| 35 | [35-error-monitoring-sentry.md](./35-error-monitoring-sentry.md) | Error Monitoring (Sentry) — API + web SDKs, `/sentry-example-page` smoke test |

---

## Key Architectural Decisions (Quick Reference)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Monorepo tool | pnpm + Turborepo | Fast builds, native workspace support |
| Backend | Express + TypeScript | Explicit control, Socket.io native |
| Database | MongoDB | Document model fits multi-tenant chat |
| Vector DB | Pinecone (namespace = orgId) | Managed, org-isolated by namespace |
| Auth (operators) | NextAuth (Google + credentials) | Built into Next.js, JWT for API |
| Auth (widget) | Contact session token (24h TTL) | No email-based lookup, localStorage |
| Billing | Paddle | SaaS-friendly, webhook-driven |
| Realtime | Socket.io | Bi-directional, room-based |
| AI provider | OpenRouter / OpenAI-compatible | Flexible model selection |
| Conversation identity | `contactSessionId` (not email) | Privacy-first, session-scoped |

---

## Constraints

- **No Convex, Clerk, or Supabase** — Express/Mongo/Pinecone/NextAuth/Paddle only
- **Email is NOT a conversation identifier** — session token only
- **Organization-level RLS on every query** — no exceptions
- **KB CRUD must sync files + embeddings** — contentHash dedup
- **Single shared AI agent** — one prompt, org-scoped tools
- **Inbox = operator chat UI** — delete `/app/chat` ("Live chat") from the template; remove `Live chat` from `app-shell.tsx` nav
- **Contact-first flow** — user provides email (required) + phone (optional) before sending first message
- **AI confidence monitoring** — every AI response includes confidence score; auto-escalate to human when below configured threshold
- **Preserve the template, swap the data** — visual layout, copy tone, and styling of the existing Next.js 16 template (marketing, dashboard, admin) are kept verbatim during the monorepo split; only mock data is replaced with API calls. See [17-template-asset-inventory.md](./17-template-asset-inventory.md).
- **CI builds; Coolify runs** — GitHub Actions produces immutable images in GHCR; Coolify pulls + serves. No "latest" tags in production.
- **MCPs are mandatory for QA** — `chrome-devtools-mcp`, `mongo-mcp`, `paddle-mcp` per [16](./16-production-readiness-audit.md); full server roster in [21-mcp-tooling.md](./21-mcp-tooling.md).

## Analysis produced after P1-P11

- [`37-rag-pipeline-audit.md`](./37-rag-pipeline-audit.md) — Stage-by-stage RAG audit: failure modes, severity, measured numbers, top-10 risks
- [`38-scale-and-load-risks.md`](./38-scale-and-load-risks.md) — What breaks under load: measured ingestion ceiling, index coverage, risk table, tests still to run
- [`45-deferred-decisions.md`](./45-deferred-decisions.md) — Deferred decisions with data: judge budget, reindex tolerance, rerank provider, full assumption register

See also [`../E2E_FLOW.md`](../E2E_FLOW.md), rewritten with Mermaid diagrams for ingestion, the reply graph, retrieval, escalation and a latency-annotated turn.
