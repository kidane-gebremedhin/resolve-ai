# ResolveAI

A **multi-tenant AI customer-support SaaS**. Any business can embed a chat widget on its
website, backed by an AI agent grounded in that organization's own knowledge base, and
managed through an operator dashboard with a real-time inbox, analytics, and billing.

Knowledge is scoped per **(organization, agent)** — each agent maps to one website and
only ever sees its own knowledge base. See [E2E_FLOW.md](E2E_FLOW.md) for how a visitor's
message becomes a knowledge-grounded answer (parse → chunk → embed → retrieve → generate).

---

## Architecture

A [pnpm](https://pnpm.io) + [Turborepo](https://turborepo.com) monorepo — **4 apps** and
**3 shared packages**, with Docker-backed infrastructure (MongoDB, Redis, MinIO, MailHog).

### Apps

| App | Package | Port | Description |
|-----|---------|------|-------------|
| Web dashboard | [`@csb/web`](apps/web) | 3000 | Next.js operator dashboard + marketing site (`/app/*`, `/admin/*`). |
| Customer widget | [`@csb/widget`](apps/widget) | 3001 | Next.js chat widget rendered inside the embedded iframe. |
| Embed loader | [`@csb/embed`](apps/embed) | 3002 | Vite `widget.js` — the `<script>` tag that injects the widget iframe onto a host site. |
| API + Socket.io | [`@csb/api`](apps/api) | 4000 | Express + Mongoose backend, REST + real-time, AI/RAG pipeline. |

### Shared packages

| Package | Description |
|---------|-------------|
| [`@csb/ui`](packages/ui) | shadcn/ui primitives + design tokens + `cn()` helper. |
| [`@csb/shared-types`](packages/shared-types) | Cross-app TypeScript model/contract types. |
| [`@csb/config`](packages/config) | Shared tooling config (TS, lint, etc.). |

### Tech stack

- **Frontend** — Next.js 16 (App Router), React 19, Tailwind CSS v4, shadcn/ui
- **Backend** — Express + TypeScript, MongoDB (Mongoose), Socket.io, Redis
- **AI / RAG** — LangGraph agent (`StateGraph`) on LangChain, OpenRouter LLM via `ChatOpenAICompletions`, OpenAI-compatible embeddings (`text-embedding-3-small`, 1536-dim), Pinecone vector DB, Firecrawl website ingestion, optional LangSmith tracing
- **Auth** — NextAuth (Google OAuth + email/password), JWT
- **Billing** — Paddle
- **Storage / email** — MinIO (S3-compatible) · MailHog (dev SMTP)
- **Infra / CI** — Docker Compose (local), Turborepo, GitHub Actions, Coolify (deploy)

---

## Quick start

```bash
pnpm install
cp .env.example .env      # then fill in secrets — see __specs/13-env-variables.md
pnpm dev:infra            # MongoDB, Redis, MailHog, MinIO via Docker
pnpm db:migrate           # sync Mongoose indexes (DB starts empty)
pnpm db:seed              # optional — manual-QA logins, one per role, on a paid plan
pnpm dev                  # run all 4 apps via Turborepo
```

Then open the dashboard at [http://localhost:3000](http://localhost:3000) and register an
account through the sign-up flow — or skip straight to `owner@example.test` /
`Test1234!` if you ran `db:seed`. See
[RUNBOOK §5.1](RUNBOOK.md#51-seed-manual-qa-accounts-optional) for the full
account list and caveats.

> **Full setup, ports, verification, production build, and troubleshooting:** [RUNBOOK.md](RUNBOOK.md).

### Common commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run all apps (hot reload) |
| `pnpm --filter @csb/<app> dev` | Run a single app (`web` / `widget` / `embed` / `api`) |
| `pnpm build` | Production build (all workspaces) |
| `pnpm test` · `pnpm lint` · `pnpm type-check` | Test / lint / typecheck across the monorepo |
| `pnpm db:migrate` | Sync MongoDB indexes |
| `pnpm db:seed` | Seed manual-QA accounts (all roles + a paid org) |
| `pnpm db:seed:coupons` | Seed LTD coupons in every rule state (see RUNBOOK §5.2) |
| `pnpm verify:env` · `pnpm verify:assets` | Validate env vars / landing-page assets |

---

## Documentation

| Doc | What it covers |
|-----|----------------|
| [RUNBOOK.md](RUNBOOK.md) | **Running the project** — prerequisites, infra, env, build, ops, troubleshooting. |
| [__specs/](__specs/) | **Design specs** — the *why*. Start at the [table of contents](__specs/00-table-of-contents.md); see also [data model](__specs/03-data-model.md), [API](__specs/07-api-specification.md), [env variables](__specs/13-env-variables.md). |
| [__plans/](__plans/) | **Implementation plans** — the *what & in what order*. Start at the [overview](__plans/00-overview.md). |
| [__skills/](__skills/) | **Reusable procedures** (Anthropic Skill format) invoked by the plans. |
| [SKILLS_GALLERY.md](SKILLS_GALLERY.md) | **Skills catalog** — purpose, provenance (custom-written vs downloaded), and phase for every skill. |
| [E2E_FLOW.md](E2E_FLOW.md) | **RAG flow** — indexing → retrieval → generation, end to end. |
| [__specs/05-ai-agent-design.md](__specs/05-ai-agent-design.md) | **AI agent** — the LangGraph state graph, tool layer, input gate and LangSmith tracing. |
| [__specs/35-error-monitoring-sentry.md](__specs/35-error-monitoring-sentry.md) | **Error monitoring** — Sentry for the API + web app, and the `/sentry-example-page` production smoke test ([RUNBOOK §14](RUNBOOK.md)). |
| `IMPLEMENTATION_AUDIT.md` | Codebase audit — architecture, strengths, ranked findings. **Local only** (git-ignored), so it is absent from a fresh clone. |
| [AGENTS.md](AGENTS.md) · [CLAUDE.md](CLAUDE.md) | Conventions for AI coding agents working in this repo. |
| `CHANGELOG_*.md` · `QA_TEST_RESULTS_*.md` | Per-session change logs and QA runs. **Local only** (git-ignored) — see `.gitignore`; they are working documents, not shipped docs. |

---

## Repository layout

```
apps/
  web/            # @csb/web    — dashboard + marketing (Next.js, :3000)
  widget/         # @csb/widget — chat widget iframe (Next.js, :3001)
  embed/          # @csb/embed  — widget.js loader (Vite, :3002)
  api/            # @csb/api    — Express + Mongoose + Socket.io (:4000)
packages/
  ui/             # @csb/ui     — shadcn primitives + tokens
  shared-types/   # @csb/shared-types — cross-app types
  config/         # @csb/config — shared tooling config
__specs/          # design specs (the why)
__plans/          # phased implementation plans (the what)
__skills/         # reusable procedures (see SKILLS_GALLERY.md)
scripts/          # repo utilities (verify-env, verify-assets, mongo-init)
coolify/          # deployment config
```
