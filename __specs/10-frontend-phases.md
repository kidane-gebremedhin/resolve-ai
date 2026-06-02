# 10 — Frontend Implementation Phases (0–4)

## Overview

Implementation is divided into five phases, each building on the previous. Each phase produces a testable increment.

---

## Phase 0: Foundation

### Objective
Set up the monorepo, configure dev tooling, wire NextAuth, and remove legacy "Live chat" routes. The template files at the repo root (Next.js 16 / React 19 / Tailwind 4) are the source of truth for visual layout — preserve them verbatim during the move, only swapping mock data for API calls. See [17-template-asset-inventory.md](./17-template-asset-inventory.md) for the complete file-by-file migration map.

### Tasks

- [ ] Initialize pnpm monorepo with Turborepo
- [ ] Scaffold `apps/web` (Next.js 16+, App Router, Tailwind 4, React 19) — match existing template versions
- [ ] Scaffold `apps/widget` (Next.js 16+)
- [ ] Scaffold `apps/embed` (Vite, vanilla TS)
- [ ] Scaffold `apps/api` (Express + TypeScript, no routes yet)
- [ ] Create `packages/ui`:
  - [ ] Copy all 40 shadcn primitives from `src/components/ui/` (see §17 §4.5)
  - [ ] Copy `src/lib/utils.ts` (cn) + `src/hooks/use-mobile.tsx`
  - [ ] Copy `components.json` (shadcn config)
  - [ ] Extract token block from `src/app/globals.css` to `packages/ui/src/styles/tokens.css`
- [ ] Create `packages/shared-types` (TypeScript interfaces from §03)
- [ ] Create `packages/config` (shared ESLint, TS, Tailwind configs)
- [ ] Configure `turbo.json` pipeline (dev, build, lint, type-check)
- [ ] Create `docker-compose.yml` (MongoDB + Redis) — see [19-local-development.md](./19-local-development.md)
- [ ] Create `.env.example` with all variables (from §13)
- [ ] **Migrate template routes**:
  - [x] Marketing: `src/app/{page,features,customers,pricing,contact,login,signup,not-found}.tsx` → `apps/web/src/app/(marketing)/...` / `(auth)/...` — `/signup` template renamed to `/register` (route lives at [apps/web/src/app/(auth)/register/page.tsx](../apps/web/src/app/(auth)/register/page.tsx))
  - [ ] Dashboard: `src/app/app/{page,inbox,knowledge,widget,leads,websites,ai,usage,billing,analytics,settings}/page.tsx` → `apps/web/src/app/(dashboard)/app/...`
  - [ ] Admin: `src/app/admin/{page,users,subscribers,subscriptions,analytics,settings}/page.tsx` → `apps/web/src/app/(admin)/admin/...`
- [ ] **Migrate template shells**:
  - [ ] `src/components/layouts/app-shell.tsx` → `apps/web/src/components/dashboard/AppShell.tsx`. **Delete** the `{ href: '/app/chat', label: 'Live chat', ... }` entry from the `nav` array. Remove the now-unused `MessageSquare` import.
  - [ ] `src/components/layouts/admin-shell.tsx` → `apps/web/src/components/admin/AdminShell.tsx`. Add `Subscriptions` and `Analytics` to the `nav` array (routes exist but sidebar is missing them).
  - [ ] `src/components/site/{MarketingShell,SiteHeader,SiteFooter,Logo}.tsx` → `apps/web/src/components/marketing/*`
  - [ ] `src/components/{theme-provider,theme-toggle}.tsx` + `src/lib/theme.ts` → `apps/web/src/components/theme/*` + `apps/web/src/lib/theme.ts`
- [ ] **Migrate landing template** `src/components/ns/**` → `apps/web/src/components/marketing/**` (see §17 §4.1)
- [ ] **DELETE** `src/app/app/chat/page.tsx` — do not migrate the `/app/chat` Live chat route
- [ ] **Migrate public assets**: copy only the folders listed in §17 §5.1 (drop the 22 MB `public/images/gradient/` and unused `home-page-N/` folders — see §17 §5.2)
- [ ] Configure NextAuth in `apps/web`:
  - [ ] Google OAuth provider (replace `SocialAuth` mock buttons with `signIn('google')`)
  - [ ] Email/password credentials provider
  - [ ] JWT session strategy
  - [ ] Auth API route (`/api/auth/[...nextauth]`)
  - [ ] Session provider wrapping `(dashboard)` and `(admin)` layouts
  - [ ] `requirePlatformAdmin` server-side guard for `(admin)` layout
- [ ] Replace mock `workspaces[]` and `UserMenu` placeholder in `AppShell` with session data
- [ ] Create `api-client.ts` in `apps/web` (typed fetch wrapper pointing to `localhost:4000`)
- [ ] Add CI workflows (see [18-cicd-pipeline.md](./18-cicd-pipeline.md)): `.github/workflows/ci.yml` runs lint + type-check + build on every PR
- [ ] Add per-app `Dockerfile` (multi-stage; Next standalone output)
- [ ] Add `.mcp.json` declaring `chrome-devtools-mcp`, `mongo-mcp`, `paddle-mcp` (see [21-mcp-tooling.md](./21-mcp-tooling.md))
- [ ] Verify: `pnpm dev` starts all 4 apps concurrently
- [ ] Verify: NextAuth Google login works end-to-end
- [ ] Verify: `apps/web` builds without errors (`pnpm build` in repo root → green)
- [ ] Verify: `pnpm verify:assets` reports zero unreferenced files under `apps/web/public/images/`

### Files/Routes

| File/Route | Action |
|------------|--------|
| `/pnpm-workspace.yaml`, `/turbo.json` | Create |
| `/docker-compose.yml`, `/docker-compose.full.yml` | Create |
| `/.nvmrc`, `/.dockerignore` | Create |
| `/.github/workflows/ci.yml` | Create |
| `/.mcp.json` | Create |
| `/apps/{web,widget,embed,api}/Dockerfile` | Create |
| `/apps/web/src/app/(auth)/login/page.tsx` | Migrate from `src/app/login/page.tsx` |
| `/apps/web/src/app/(auth)/register/page.tsx` | Migrate from `src/app/signup/page.tsx` |
| `/apps/web/src/app/api/auth/[...nextauth]/route.ts` | Create |
| `/apps/web/src/lib/auth.ts` | Create (NextAuth config) |
| `/apps/web/src/components/dashboard/AppShell.tsx` | Migrate + edit (remove `Live chat`) |
| `/apps/web/src/components/admin/AdminShell.tsx` | Migrate + edit (add `Subscriptions`, `Analytics`) |
| `src/app/app/chat/page.tsx` | **DELETE** (do not migrate) |

### Dependencies
- None (first phase)

### Acceptance Criteria
- [ ] `pnpm dev` starts web (3000), widget (3001), embed (3002), api (4000)
- [ ] Google OAuth login produces a valid JWT
- [ ] No `/app/chat` route or `Live chat` string exists anywhere under `apps/web/`
- [ ] All TypeScript compiles with zero errors
- [ ] Shared packages are importable from all apps
- [ ] Cookie-driven light/dark theme works on first paint on every route group (marketing, dashboard, admin)
- [ ] Admin sidebar lists Dashboard / Users / Subscribers / Subscriptions / Analytics / Settings
- [ ] CI pipeline (`.github/workflows/ci.yml`) is green on the migration PR
- [ ] All 4 apps build successfully under `docker build` (locally)

---

## Phase 1: Backend Core

### Objective
Stand up the Express API with auth, MongoDB models, contact sessions, and basic conversation/message CRUD.

### Tasks

- [ ] Set up Express app with middleware stack:
  - [ ] Helmet, CORS, JSON body parser
  - [ ] Winston logger with daily rotate
  - [ ] express-rate-limit (global + per-route)
  - [ ] Joi validation middleware
  - [ ] Error handler middleware
- [ ] Connect MongoDB (Mongoose) with connection pooling
- [ ] Create all Mongoose models (§03):
  - [ ] Organization, User, Membership
  - [ ] Website, Agent
  - [ ] ContactSession (with TTL index)
  - [ ] Conversation, Message
  - [ ] KnowledgeSource, WidgetSettings, Subscription, Section
- [ ] Implement auth routes:
  - [ ] `POST /auth/register` (bcrypt password, create org + membership)
  - [ ] `POST /auth/login` (verify password, return JWT)
  - [ ] `POST /auth/google` (verify Google token, upsert user)
  - [ ] `POST /auth/refresh` (refresh JWT)
- [ ] Implement JWT middleware (`auth.middleware.ts`)
- [ ] Implement org context middleware (`org-context.middleware.ts`)
- [ ] Implement organization routes (GET/PATCH current, members CRUD)
- [ ] Implement website routes (CRUD)
- [ ] Implement agent routes (CRUD)
- [ ] Implement contact session routes:
  - [ ] `POST /widget/sessions` (create/resume)
  - [ ] `POST /widget/sessions/:id/contact` (update contact info)
  - [ ] Widget auth middleware (session token validation)
- [ ] Implement conversation routes:
  - [ ] `POST /widget/conversations` (start conversation)
  - [ ] `GET /conversations` (inbox list with filters)
  - [ ] `GET /conversations/:id` (detail)
  - [ ] `PATCH /conversations/:id/status` (resolve/escalate/reopen)
- [ ] Implement message routes:
  - [ ] `POST /widget/conversations/:id/messages` (customer message)
  - [ ] `POST /conversations/:id/messages` (operator message)
  - [ ] `GET /conversations/:id/messages` (thread)
- [ ] Write integration tests for auth + conversation flow

### Files/Routes (API)

| File | Action |
|------|--------|
| `apps/api/src/index.ts` | Create (Express app setup) |
| `apps/api/src/config/*.ts` | Create (env, db, logger) |
| `apps/api/src/models/*.ts` | Create (all 12 models) |
| `apps/api/src/middleware/*.ts` | Create (auth, org-context, validation, rate-limit, error) |
| `apps/api/src/routes/*.ts` | Create (auth, org, website, agent, conversation, message, contact, widget) |
| `apps/api/src/controllers/*.ts` | Create |
| `apps/api/src/services/*.ts` | Create (conversation, message, contact, org) |

### Dependencies
- Phase 0 (monorepo structure, NextAuth)

### Acceptance Criteria
- [ ] Full auth flow works: register → login → JWT → protected routes
- [ ] Contact session creation and 24h TTL expiry works
- [ ] Start conversation, send messages, list inbox all functional
- [ ] Resolve/escalate status transitions work correctly
- [ ] Org RLS enforced on every query (verified with multi-org test)
- [ ] Seed script creates testable data
- [ ] All routes return correct HTTP status codes and error formats

---

## Phase 2: Widget + Embed + Sockets

### Objective
Build the chat widget (iframe), embed loader script, and Socket.io real-time messaging. Deliver the end-to-end customer chat experience.

### Tasks

- [ ] **Socket.io server** setup in `apps/api`:
  - [ ] Attach Socket.io to HTTP server
  - [ ] Auth middleware (JWT for dashboard, session token for widget)
  - [ ] Room management (conversation rooms, org rooms)
  - [ ] Event handlers (message:new, conversation:status, typing)
  - [ ] Emit from REST handlers on message create/status change
- [ ] **Widget App** (`apps/widget`):
  - [ ] `WidgetShell.tsx` — top-level state router (implements state machine from §09)
  - [ ] `PreChatScreen.tsx` — greeting, suggested questions, **inline email (required) + phone (optional) fields**, message input. Send button disabled until valid email.
  - [ ] `ChatWindow.tsx` — message list with auto-scroll
  - [ ] `MessageBubble.tsx` — styled bubbles for customer/AI/operator/system
  - [ ] `Composer.tsx` — text input + emoji picker + file attachment
  - [ ] `ContactForm.tsx` — email/phone capture (non-blocking overlay)
  - [ ] `SectionsScreen.tsx` — quick navigation links
  - [ ] `ResolvedScreen.tsx` — conversation closed state
  - [ ] `TypingIndicator.tsx` — animated dots
  - [ ] `FileAttachment.tsx` — upload + display
  - [ ] Session management (localStorage, §09)
  - [ ] Socket.io client integration
  - [ ] API client for widget endpoints
- [ ] **Embed Script** (`apps/embed`):
  - [ ] `widget.ts` — read `data-*` attributes, inject iframe
  - [ ] Floating button (bottom-right/left, customizable)
  - [ ] Open/close toggle
  - [ ] Vite build → single `widget.js` file
  - [ ] PostMessage bridge for iframe ↔ parent (optional)
- [ ] **File uploads** in widget:
  - [ ] `POST /widget/conversations/:id/attachments`
  - [ ] File storage (local disk for dev, S3 for prod)
  - [ ] MIME type validation, size limits
- [ ] **AI agent integration**:
  - [ ] Connect AI agent service (§05) to message flow
  - [ ] Customer message → AI response → Socket.io emit
  - [ ] Tool execution (search, resolve, escalate)
- [ ] Wire `apps/web` dashboard to Socket.io for real-time inbox updates

### Files/Routes

| File | Action |
|------|--------|
| `apps/api/src/socket/*` | Create (server, handlers, auth) |
| `apps/widget/src/components/*` | Create (all widget components) |
| `apps/widget/src/lib/session.ts` | Create |
| `apps/widget/src/lib/socket.ts` | Create |
| `apps/widget/src/lib/api-client.ts` | Create |
| `apps/embed/src/widget.ts` | Create |
| `apps/api/src/services/ai/agent.service.ts` | Create |
| `apps/api/src/services/ai/prompts.ts` | Create |

### Dependencies
- Phase 1 (API, models, auth, conversation/message CRUD)

### Acceptance Criteria
- [ ] Embed script creates floating button + iframe on any HTML page
- [ ] Customer can start conversation, receive AI response in real time
- [ ] Contact info (email required, phone optional) collected inline in pre-chat screen before first message
- [ ] Session persists across page refreshes (localStorage)
- [ ] Session expires after 24h of inactivity → fresh start
- [ ] File attachments upload and display in thread
- [ ] Emoji picker works in composer
- [ ] Typing indicator shows while AI is processing
- [ ] Resolved conversation shows resolved screen
- [ ] Socket.io reconnects transparently on network interruption
- [ ] AI confidence score stored per message; low confidence auto-escalates to human

---

## Phase 3: Inbox + KB + Operator Tools

### Objective
Build the operator inbox, conversation thread view, message enhancement, and full Knowledge Base CRUD with Pinecone sync.

### Tasks

- [ ] **Inbox UI** (`/app/inbox`):
  - [ ] Conversation list with filters (status, website, assigned)
  - [ ] Real-time updates via Socket.io (new messages, status changes)
  - [ ] Unread indicators
  - [ ] Search conversations
  - [ ] Workspace switcher (all websites vs specific website)
- [ ] **Conversation Thread View** (`/app/inbox/[conversationId]`):
  - [ ] Message thread with all message types
  - [ ] Operator reply composer
  - [ ] "✨ Enhance" button for message enhancement (§06)
  - [ ] Resolve/escalate/reopen actions
  - [ ] Assign to operator
  - [ ] Contact info sidebar (name, email, phone)
  - [ ] Conversation metadata (started, website, status history)
- [ ] **Message Enhancement** endpoint:
  - [ ] `POST /api/v1/messages/enhance` (§06)
  - [ ] Frontend UX: enhance button → preview → accept/revert → send
- [ ] **Knowledge Base UI** (`/app/knowledge`):
  - [ ] Source list with type icons and status badges
  - [ ] Create text source (inline editor)
  - [ ] Upload file source (PDF, DOCX, Excel, CSV, Image, HTML)
  - [ ] Ingest website URL (Firecrawl)
  - [ ] Edit existing source
  - [ ] Delete source (with confirmation)
  - [ ] Embedding status indicator (pending/synced/error)
  - [ ] Retry failed embeddings
- [ ] **KB Backend**:
  - [ ] Pinecone client setup
  - [ ] Embedding service (OpenAI text-embedding-3-small)
  - [ ] Chunking service
  - [ ] File parsers (PDF, DOCX, Excel, CSV, HTML → text)
  - [ ] Image processing (vision model description)
  - [ ] Firecrawl integration
  - [ ] ContentHash generation and dedup check
  - [ ] CRUD routes with Pinecone sync (§04)
  - [ ] Reconciliation job (retry failed embeddings)
- [ ] **AI search tool** connected to Pinecone:
  - [ ] Query org namespace
  - [ ] Return formatted results to agent
- [ ] **Widget settings UI** (`/app/widget`):
  - [ ] Layout must match the template at `/app/widget` in `customer-service-chatbot-template` (Widget Studio page with controls panel + live preview)
  - [ ] Three-tab control panel: Design (accent color, corner radius, position, avatar style), Content (title, subtitle, agent name, placeholder, welcome message), Behavior (launcher label, branding toggle, embed snippet)
  - [ ] Live preview panel: browser chrome mockup with embedded widget preview, desktop/mobile toggle
  - [ ] Branding customization (colors, avatar, title, subtitle)
  - [ ] Suggested questions editor
  - [ ] Position selector
  - [ ] Confidence threshold slider (per-agent, affects AI auto-escalation)
  - [ ] Live preview
- [ ] **Sections management**:
  - [ ] CRUD for widget sections
  - [ ] Drag-and-drop reorder
- [ ] **Leads view** (`/app/leads`):
  - [ ] List contact sessions with email/phone
  - [ ] Filter by website, has-email
  - [ ] Link to conversation history

### Files/Routes

| Route | Action |
|-------|--------|
| `/app/inbox/page.tsx` | Wire to API (replace mock data) |
| `/app/inbox/[conversationId]/page.tsx` | Create (thread view) |
| `/app/knowledge/page.tsx` | Wire to API |
| `/app/knowledge/[sourceId]/page.tsx` | Create (detail view) |
| `/app/widget/page.tsx` | Wire to API |
| `/app/leads/page.tsx` | Wire to API |
| `apps/api/src/routes/kb.routes.ts` | Create |
| `apps/api/src/services/kb/*` | Create |
| `apps/api/src/services/ai/embedding.service.ts` | Create |
| `apps/api/src/services/ai/enhance.service.ts` | Create |
| `apps/api/src/jobs/embedding-sync.job.ts` | Create |

### Dependencies
- Phase 2 (widget, Socket.io, AI agent)

### Acceptance Criteria
- [ ] Inbox shows real conversations with real-time updates
- [ ] Operator can reply to customer, message appears instantly in widget
- [ ] Enhance button polishes operator message without changing intent
- [ ] KB: upload PDF → text extracted → chunked → embedded in Pinecone → AI can search
- [ ] KB: duplicate upload detected by contentHash → rejected
- [ ] KB: delete source → Pinecone vectors removed
- [ ] KB: website crawl via Firecrawl → pages ingested
- [ ] Widget settings changes reflected in live widget
- [ ] Workspace filter filters inbox/analytics by selected website
- [ ] Leads view shows contacts with conversation counts

---

## Phase 4: Billing, Admin, Polish

### Objective
Integrate Paddle billing, build admin panel, add analytics, polish the landing page, and implement audio notifications.

### Tasks

- [ ] **Paddle Billing**:
  - [ ] Paddle SDK integration
  - [ ] Checkout flow (plan selection → Paddle checkout → webhook)
  - [ ] Webhook handler (subscription events → update DB)
  - [ ] Subscription status display in `/app/billing`
  - [ ] Plan limits enforcement (AI messages, KB sources, crawl pages)
  - [ ] Customer portal link (manage subscription)
  - [ ] Upgrade/downgrade flows
- [ ] **Admin Panel** (`/app/settings`):
  - [ ] Organization settings (name, slug, timezone)
  - [ ] User profile settings
  - [ ] Team management (invite, role change, remove)
  - [ ] Platform admin routes (if user.role = platform_admin):
    - [ ] List all organizations
    - [ ] Platform statistics
    - [ ] Impersonate org (for debugging)
- [ ] **Analytics** (`/app/analytics`):
  - [ ] Overview cards: total conversations, resolved, escalated, avg response time
  - [ ] Charts: conversations over time, resolution rate
  - [ ] Top KB queries (popular search terms)
  - [ ] Filter by website and time period
- [ ] **Landing Page Polish**:
  - [ ] Update marketing copy for product
  - [ ] Pricing page tied to Paddle plans
  - [ ] Features page
  - [ ] Demo widget embedded on landing page
  - [ ] SEO optimization (meta tags, OG images)
- [ ] **Audio Notifications**:
  - [ ] Notification sound on new message (operator dashboard)
  - [ ] Beep sound on send (widget)
  - [ ] Providers: built-in Web Audio API or preloaded MP3
  - [ ] User preference: enable/disable sounds in settings
  - [ ] TTS option for AI replies:
    - Providers: OpenAI TTS, ElevenLabs, browser SpeechSynthesis
- [ ] **Websites page** (`/app/websites`):
  - [ ] CRUD for websites
  - [ ] Embed code generator per website
  - [ ] Allowed origins management
- [ ] **Session cleanup job**:
  - [ ] Cron: delete expired contact sessions (backup for TTL index)
- [ ] **Production deployment prep**:
  - [ ] Environment variable audit
  - [ ] Build optimization
  - [ ] Docker deployment config
  - [ ] CDN setup for embed script

### Files/Routes

| Route | Action |
|-------|--------|
| `/app/billing/page.tsx` | Wire to Paddle |
| `/app/analytics/page.tsx` | Wire to API |
| `/app/settings/page.tsx` | Wire to API |
| `/app/team/page.tsx` | Wire to API |
| `/app/websites/page.tsx` | Wire to API |
| `/(marketing)/page.tsx` | Polish |
| `/(marketing)/pricing/page.tsx` | Create |
| `/(marketing)/features/page.tsx` | Create |
| `apps/api/src/routes/billing.routes.ts` | Create |
| `apps/api/src/routes/admin.routes.ts` | Create |
| `apps/api/src/services/billing.service.ts` | Create |
| `apps/api/src/jobs/session-cleanup.job.ts` | Create |

### Dependencies
- Phase 3 (inbox, KB, full operator tools)

### Acceptance Criteria
- [ ] Paddle checkout → subscription created → plan updated → limits enforced
- [ ] Webhook handles all subscription lifecycle events
- [ ] Analytics show accurate data filtered by website and time
- [ ] Admin can manage team members (invite, change role, remove)
- [ ] Platform admin can view all orgs and stats (but not data)
- [ ] Landing page looks professional and includes working demo widget
- [ ] Audio notification plays on new chat message sent and new inbox message arrival (toggleable in both widget and operator dashboard)
- [ ] Website management with per-site embed code generation
- [ ] All pages wired to real API (zero mock data remaining)

---

## Phase Summary

| Phase | Focus | Key Deliverables |
|-------|-------|-----------------|
| **0** | Foundation | Monorepo, NextAuth, cleanup |
| **1** | Backend | Express API, MongoDB, auth, CRUD |
| **2** | Widget | Chat widget, embed script, Socket.io, AI agent |
| **3** | Operator | Inbox, KB CRUD, Pinecone, enhancement LLM |
| **4** | Polish | Billing, admin, analytics, landing, audio |
| **Total** | | Full production system |
