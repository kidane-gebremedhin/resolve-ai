# 02 — Recommended Monorepo Structure

## Overview

The project uses a **pnpm workspace + Turborepo** monorepo with four apps and three shared packages. This structure replaces the current single Next.js app.

---

## Directory Tree

```
resolve-ai/
│
├── apps/
│   ├── web/                          # Next.js 15+ (App Router)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (marketing)/      # Landing, pricing, features (public)
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   ├── pricing/
│   │   │   │   │   └── features/
│   │   │   │   ├── (auth)/           # Login, register, forgot-password
│   │   │   │   │   ├── login/
│   │   │   │   │   ├── register/
│   │   │   │   │   └── forgot-password/
│   │   │   │   ├── (dashboard)/      # Operator dashboard (protected)
│   │   │   │   │   ├── layout.tsx    # Sidebar + workspace switcher
│   │   │   │   │   ├── app/
│   │   │   │   │   │   ├── page.tsx          # Dashboard home
│   │   │   │   │   │   ├── inbox/
│   │   │   │   │   │   │   ├── page.tsx      # Conversation list
│   │   │   │   │   │   │   └── [conversationId]/
│   │   │   │   │   │   │       └── page.tsx  # Thread view
│   │   │   │   │   │   ├── knowledge/
│   │   │   │   │   │   │   ├── page.tsx      # KB list
│   │   │   │   │   │   │   └── [sourceId]/
│   │   │   │   │   │   │       └── page.tsx  # KB source detail
│   │   │   │   │   │   ├── widget/
│   │   │   │   │   │   │   └── page.tsx      # Widget customization
│   │   │   │   │   │   ├── websites/
│   │   │   │   │   │   │   └── page.tsx      # Website management
│   │   │   │   │   │   ├── analytics/
│   │   │   │   │   │   │   └── page.tsx      # Analytics dashboard
│   │   │   │   │   │   ├── billing/
│   │   │   │   │   │   │   └── page.tsx      # Paddle subscription
│   │   │   │   │   │   ├── settings/
│   │   │   │   │   │   │   └── page.tsx      # Org + user settings
│   │   │   │   │   │   ├── leads/
│   │   │   │   │   │   │   └── page.tsx      # Contact/lead list
│   │   │   │   │   │   └── team/
│   │   │   │   │   │       └── page.tsx      # Team member management
│   │   │   │   │   └── developers/
│   │   │   │   │       └── page.tsx          # Developer toolkit / embed docs
│   │   │   │   ├── api/
│   │   │   │   │   └── auth/
│   │   │   │   │       └── [...nextauth]/
│   │   │   │   │           └── route.ts      # NextAuth API route
│   │   │   │   ├── layout.tsx
│   │   │   │   └── globals.css
│   │   │   ├── components/
│   │   │   │   ├── dashboard/        # Dashboard-specific components
│   │   │   │   ├── marketing/        # Landing page components
│   │   │   │   └── shared/           # Shared UI components
│   │   │   ├── lib/
│   │   │   │   ├── auth.ts           # NextAuth config
│   │   │   │   ├── api-client.ts     # Typed fetch wrapper for Express API
│   │   │   │   ├── socket.ts         # Socket.io client init
│   │   │   │   └── utils.ts
│   │   │   ├── hooks/
│   │   │   │   ├── use-socket.ts
│   │   │   │   ├── use-workspace.ts  # Current website filter
│   │   │   │   └── use-inbox.ts
│   │   │   └── providers/
│   │   │       ├── session-provider.tsx
│   │   │       └── socket-provider.tsx
│   │   ├── public/
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── widget/                       # Next.js 15+ (App Router) — iframe
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx          # Widget entry (reads query params)
│   │   │   │   ├── layout.tsx
│   │   │   │   └── globals.css
│   │   │   ├── components/
│   │   │   │   ├── chat/
│   │   │   │   │   ├── ChatWindow.tsx
│   │   │   │   │   ├── MessageBubble.tsx
│   │   │   │   │   ├── Composer.tsx      # Input + emoji + attachments
│   │   │   │   │   ├── TypingIndicator.tsx
│   │   │   │   │   └── FileAttachment.tsx
│   │   │   │   ├── screens/
│   │   │   │   │   ├── PreChatScreen.tsx   # "How can we help?"
│   │   │   │   │   ├── ContactForm.tsx     # Email/phone capture
│   │   │   │   │   ├── SectionsScreen.tsx  # Quick nav links
│   │   │   │   │   └── ResolvedScreen.tsx  # Conversation closed
│   │   │   │   └── WidgetShell.tsx         # Top-level state router
│   │   │   ├── lib/
│   │   │   │   ├── session.ts        # localStorage session management
│   │   │   │   ├── api-client.ts     # Widget API calls
│   │   │   │   └── socket.ts         # Socket.io client
│   │   │   └── hooks/
│   │   │       ├── use-session.ts
│   │   │       ├── use-chat.ts
│   │   │       └── use-widget-config.ts
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── embed/                        # Vite (vanilla TS) — widget.js loader
│   │   ├── src/
│   │   │   └── widget.ts            # Reads data-* attrs, injects iframe
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── api/                          # Express + Socket.io + TypeScript
│       ├── src/
│       │   ├── index.ts              # Express app + HTTP server + Socket.io attach
│       │   ├── config/
│       │   │   ├── env.ts            # Env validation (dotenv + Joi)
│       │   │   ├── db.ts             # MongoDB connection (Mongoose)
│       │   │   ├── pinecone.ts       # Pinecone client init
│       │   │   ├── redis.ts          # Redis client (optional, for sessions/rate-limit)
│       │   │   └── logger.ts         # Winston config
│       │   ├── models/               # Mongoose schemas
│       │   │   ├── Organization.ts
│       │   │   ├── User.ts
│       │   │   ├── Membership.ts
│       │   │   ├── Website.ts
│       │   │   ├── Agent.ts
│       │   │   ├── ContactSession.ts
│       │   │   ├── Conversation.ts
│       │   │   ├── Message.ts
│       │   │   ├── KnowledgeSource.ts
│       │   │   ├── WidgetSettings.ts
│       │   │   ├── Subscription.ts
│       │   │   └── Section.ts
│       │   ├── routes/
│       │   │   ├── index.ts          # Route aggregator
│       │   │   ├── auth.routes.ts
│       │   │   ├── org.routes.ts
│       │   │   ├── conversation.routes.ts
│       │   │   ├── message.routes.ts
│       │   │   ├── kb.routes.ts
│       │   │   ├── agent.routes.ts
│       │   │   ├── website.routes.ts
│       │   │   ├── widget.routes.ts   # Public widget endpoints
│       │   │   ├── contact.routes.ts  # Contact session CRUD
│       │   │   ├── billing.routes.ts  # Paddle webhooks
│       │   │   └── admin.routes.ts
│       │   ├── controllers/          # Route handlers
│       │   ├── services/             # Business logic
│       │   │   ├── ai/
│       │   │   │   ├── agent.service.ts        # Shared AI agent
│       │   │   │   ├── enhance.service.ts      # Operator message enhancement
│       │   │   │   ├── embedding.service.ts    # Text → vector
│       │   │   │   └── prompts.ts              # System prompts
│       │   │   ├── kb/
│       │   │   │   ├── kb.service.ts           # KB CRUD orchestrator
│       │   │   │   ├── ingestion.service.ts    # File processing pipeline
│       │   │   │   ├── chunker.service.ts      # Text → chunks
│       │   │   │   └── firecrawl.service.ts    # Website scraping
│       │   │   ├── conversation.service.ts
│       │   │   ├── message.service.ts
│       │   │   ├── contact.service.ts
│       │   │   ├── org.service.ts
│       │   │   └── billing.service.ts
│       │   ├── middleware/
│       │   │   ├── auth.middleware.ts           # JWT verification
│       │   │   ├── org-context.middleware.ts    # Inject orgId, enforce RLS
│       │   │   ├── widget-auth.middleware.ts    # Contact session token validation
│       │   │   ├── rate-limit.middleware.ts
│       │   │   ├── validation.middleware.ts     # Joi schema validation
│       │   │   └── error-handler.middleware.ts
│       │   ├── socket/
│       │   │   ├── index.ts            # Socket.io server setup
│       │   │   ├── handlers/
│       │   │   │   ├── message.handler.ts
│       │   │   │   ├── conversation.handler.ts
│       │   │   │   └── typing.handler.ts
│       │   │   └── auth.ts             # Socket auth middleware
│       │   ├── jobs/                   # Background workers
│       │   │   ├── embedding-sync.job.ts      # Retry failed embeddings
│       │   │   ├── session-cleanup.job.ts     # Expire old contact sessions
│       │   │   └── firecrawl-ingest.job.ts    # Async website crawling
│       │   ├── utils/
│       │   │   ├── content-hash.ts    # SHA-256 of normalized text
│       │   │   ├── chunker.ts         # Text splitting strategy
│       │   │   ├── file-parsers.ts    # PDF, DOCX, Excel, CSV extractors
│       │   │   └── errors.ts          # Custom error classes
│       │   └── types/
│       │       └── index.ts           # API-specific types
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── ui/                           # Shared shadcn/ui components
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── button.tsx
│   │   │   │   ├── input.tsx
│   │   │   │   ├── dialog.tsx
│   │   │   │   └── ...               # All shared shadcn components
│   │   │   └── index.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── shared-types/                 # TypeScript interfaces
│   │   ├── src/
│   │   │   ├── models.ts             # DB model interfaces
│   │   │   ├── api.ts                # Request/response DTOs
│   │   │   ├── socket.ts             # Socket.io event types
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── rag-eval/                     # Offline RAG evaluation harness
│   │   ├── src/
│   │   │   ├── cli.ts                # `pnpm eval:rag`
│   │   │   ├── fixtures.ts           # Seeds the fixture org/agent/KB
│   │   │   ├── runner.ts             # Calls searchKb + generateAiReply
│   │   │   ├── judge.ts              # LLM-as-judge + verdict cache
│   │   │   ├── cost.ts               # Cost settle pass
│   │   │   ├── report.ts             # Table, JSON, baseline diff
│   │   │   └── metrics/              # Pure, unit-tested metric functions
│   │   ├── fixtures/
│   │   │   ├── kb/*.md               # The fixture knowledge base
│   │   │   └── golden.json           # Golden cases
│   │   ├── reports/                  # Run artefacts (gitignored)
│   │   ├── tsconfig.json             # `@api/*` path into apps/api
│   │   └── package.json
│   │
│   └── config/                       # Shared configs
│       ├── eslint/
│       │   └── base.js
│       ├── typescript/
│       │   └── base.json
│       └── package.json
│
├── apps/web/Dockerfile               # Multi-stage; Next standalone output
├── apps/widget/Dockerfile            # Multi-stage; Next standalone output
├── apps/embed/Dockerfile             # Vite static build → nginx
├── apps/api/Dockerfile               # tsc build → node:20-alpine runtime
├── .github/workflows/                # CI/CD (lint, test, build, image push)
│   ├── ci.yml
│   ├── deploy-staging.yml
│   └── deploy-production.yml
├── coolify/                          # Per-environment Coolify compose overrides
│   ├── docker-compose.dev.yml
│   ├── docker-compose.staging.yml
│   └── docker-compose.production.yml
├── .mcp.json                         # MCP server configuration (chrome-devtools, paddle, mongo)
├── turbo.json                        # Turborepo pipeline config
├── pnpm-workspace.yaml               # Workspace definition
├── package.json                      # Root scripts
├── .env.example                      # All env vars documented
├── .gitignore
├── .dockerignore
├── .nvmrc                            # Pin Node version (20.x) for CI
├── docker-compose.yml                # MongoDB + Redis for local dev
├── docker-compose.full.yml           # All apps + infra (Coolify-style smoke test)
├── __specs/                          # This specification directory
└── README.md
```

---

## Port Allocation

| App | Dev Port | Purpose |
|-----|----------|---------|
| `apps/web` | 3000 | Marketing + operator dashboard |
| `apps/widget` | 3001 | Chat widget iframe |
| `apps/embed` | 3002 | widget.js loader (Vite dev server) |
| `apps/api` | 4000 | Express REST API + Socket.io |
| MongoDB | 27017 | Primary database |
| Redis | 6379 | Session store / rate-limit (optional) |

---

## Workspace Configuration

### `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### Root `package.json`

```json
{
  "name": "resolve-ai",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "type-check": "turbo type-check",
    "clean": "turbo clean",
    "db:migrate": "pnpm --filter @csb/api db:migrate"
  },
  "devDependencies": {
    "turbo": "^2.x",
    "typescript": "^5.x"
  },
  "packageManager": "pnpm@9.x"
}
```

### `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env"],
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true,
      "dependsOn": ["^build"]
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "type-check": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

---

## Package Naming Convention

All packages use the `@csb/` scope (customer-service-bot):

| Package | Name |
|---------|------|
| `apps/web` | `@csb/web` |
| `apps/widget` | `@csb/widget` |
| `apps/embed` | `@csb/embed` |
| `apps/api` | `@csb/api` |
| `packages/ui` | `@csb/ui` |
| `packages/shared-types` | `@csb/shared-types` |
| `packages/config` | `@csb/config` |

---

## Migration from Current Single Next.js App

The current project is **not empty** — it ships a Next.js 16 + React 19 + Tailwind 4 marketing/dashboard/admin template at the root. See [17-template-asset-inventory.md](./17-template-asset-inventory.md) for the file-by-file migration map.

Migration steps:

### Step 1: Initialize monorepo root
```bash
pnpm init
# Add turbo, create pnpm-workspace.yaml, turbo.json
```

### Step 2: Scaffold apps
```bash
# Web (Next.js)
pnpm create next-app apps/web --typescript --tailwind --eslint --app --src-dir

# Widget (Next.js)
pnpm create next-app apps/widget --typescript --tailwind --eslint --app --src-dir

# Embed (Vite)
pnpm create vite apps/embed --template vanilla-ts

# API (Express from scratch)
mkdir -p apps/api/src && cd apps/api && pnpm init
```

### Step 3: Move existing template assets

Follow [17-template-asset-inventory.md](./17-template-asset-inventory.md) §7 (Migration Order). High-level:

- Marketing routes `src/app/{page,features,customers,pricing,contact,signup,login,not-found}` → `apps/web/src/app/(marketing)/*` and `(auth)/*` — `/signup` template renamed to `/register` (done; see [11-page-wiremap.md](./11-page-wiremap.md))
- Dashboard routes `src/app/app/*` → `apps/web/src/app/(dashboard)/app/*`
- Admin routes `src/app/admin/*` → `apps/web/src/app/(admin)/admin/*`
- Layout shells `src/components/layouts/{app-shell,admin-shell}.tsx` → `apps/web/src/components/{dashboard,admin}/*`
- Marketing components `src/components/{ns,site}/*` → `apps/web/src/components/marketing/*`
- shadcn primitives `src/components/ui/*` → `packages/ui/src/components/*`
- Theme system `src/components/theme-{provider,toggle}.tsx`, `src/lib/theme.ts` → `apps/web/src/components/theme/*` + `apps/web/src/lib/theme.ts`
- Global styles `src/app/globals.css` → `apps/web/src/app/globals.css` (extract tokens to `packages/ui/src/styles/tokens.css`). **Tailwind v4 requires `@source "../../../../packages/ui/src/**/*.{js,ts,jsx,tsx}";` here so utility classes consumed by shadcn primitives in `@csb/ui` are emitted into the bundle.** Without it Dialog/DropdownMenu/Popover/Select still mount, but `top-[50%]`, `translate-*-[-50%]`, `bg-popover`, `data-[state=open]:animate-in`, and the dropdown shadow utilities are missing — overlays render at `top: <docHeight>` with `transform: none` and look like "the click did nothing".
- Public assets: **only** the folders listed in §17 §5.1 — drop the 22 MB `public/images/gradient/` folder and all unused `home-page-N/` folders.
- **Delete** `/app/chat` route file and the `Live chat` nav entry from `app-shell.tsx`
- **Add** `Subscriptions` and `Analytics` entries to `admin-shell.tsx` nav (template routes exist but sidebar is missing them)

### Step 4: Configure shared packages
- Extract shared TypeScript interfaces → `packages/shared-types/`
- Move shadcn components + `cn()` + `use-mobile` → `packages/ui/`
- Copy `components.json` (shadcn config) into `packages/ui/` so future `shadcn add` runs against the package
- Set up shared config → `packages/config/`

### Step 5: Set up local dev environment
- Create `docker-compose.yml` for MongoDB + Redis (see [19-local-development.md](./19-local-development.md))
- Create `.env.example` with all required variables (see [13-env-variables.md](./13-env-variables.md))
- Configure Turborepo dev pipeline
- Wire pre-commit hooks (lint + type-check) — see [18-cicd-pipeline.md](./18-cicd-pipeline.md) §Local Hooks

### Step 6: Set up CI/CD and deployment
- Add GitHub Actions workflows (see [18-cicd-pipeline.md](./18-cicd-pipeline.md))
- Create per-app `Dockerfile` (multi-stage, output `standalone` for Next.js)
- Configure Coolify projects per environment (see [20-coolify-deployment.md](./20-coolify-deployment.md))

---

## Environment File Strategy

Each app has its own `.env` file, with shared variables referenced from root:

```
resolve-ai/
├── .env                    # Shared (DB URLs, API keys)
├── apps/web/.env.local     # NextAuth secrets, API URL
├── apps/widget/.env.local  # API URL, widget-specific
├── apps/embed/.env.local   # Widget URL for iframe
└── apps/api/.env           # All backend secrets
```

> Full variable listing in [13-env-variables.md](./13-env-variables.md)
