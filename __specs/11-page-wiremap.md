# 11 — Page-by-Page Wire-up Map

## Overview

This table maps every route in the application from its current state to target implementation, including the API endpoints each page consumes.

---

## Marketing / Public Pages

| Route | Current State | Target | API Endpoints | Phase |
|-------|---------------|--------|---------------|-------|
| `/` | `HomePageContent` (template) | Polish copy, add demo widget, update CTAs. **Authenticated visitors auto-redirect to `/app`** (server-side check via `await auth()`). | None (static) | 4 |
| `/features` | `FeaturesPageContent` (template) | Features page with product screenshots | None (static) | 4 |
| `/customers` | `CustomersPageContent` (template) | Customer logos + case-study cards | None (static) | 4 |
| `/pricing` | `PricingPageContent` (template) | Pricing page tied to Paddle plans | `GET /billing/plans` (optional) | 4 |
| `/contact` | `ContactPageContent` (template) | Lead-capture form | `POST /contact` | 4 |
| `/about` | Not present in template | Optional company page | None (static) | 4 |
| `/blog` | Not planned for v1 | Skip | — | — |

> Marketing routes live under `apps/web/src/app/(marketing)/*` and share `MarketingShell` (`SiteHeader` + `SiteFooter`). See [17-template-asset-inventory.md](./17-template-asset-inventory.md) §1.

---

## Auth Pages

| Route | Current State | Target | API Endpoints | Phase |
|-------|---------------|--------|---------------|-------|
| `/login` | `LoginPageContent` (template) — `SocialAuth` + form | Wire to NextAuth `signIn()` | NextAuth internal + `POST /auth/login` | 0 |
| `/register` | `SignupPageContent` (template originally at `/signup`, rename to `/register` complete) | Wire to NextAuth + API registration | `POST /auth/register` → auto-login | 0 |
| `/forgot-password` | Does not exist in template | Create from `LoginPageContent` pattern | `POST /auth/forgot-password`, `POST /auth/reset-password` | 1 |
| `/verify-email` | Does not exist | Email verification landing | `POST /auth/verify-email` | 1 |
| `/invite/accept` | Does not exist | Accept org invitation | `POST /orgs/invitations/accept` | 3 |

---

## Dashboard Pages (Protected `/app/*`)

| Route | Current State | Target | API Endpoints | Phase |
|-------|---------------|--------|---------------|-------|
| `/app` | Template KPI cards (mock data) | Real-time overview cards + recent conversations | `GET /billing/usage`, `GET /conversations?limit=5` | 3–4 |
| `/app/inbox` | Template inbox list (mock data) | Real inbox: filterable conversation list with real-time updates | `GET /conversations?status=...&websiteId=...`, Socket.io `conversation:updated`, `conversation:new` | 3 |
| `/app/inbox/[conversationId]` | Does not exist | Thread view: messages, reply composer, enhance, resolve/escalate, contact sidebar | `GET /conversations/:id`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages`, `POST /messages/enhance`, `PATCH /conversations/:id/status`, Socket.io `message:new` | 3 |
| `/app/chat` | **EXISTS — Live chat (template)** | **DELETE entirely** — remove route file + sidebar entry + `MessageSquare` import in `AppShell` | — | 0 |
| `/app/knowledge` | Template KB list (mock sources) | KB source list with type badges, status, CRUD actions | `GET /knowledge?type=...&status=...`, `POST /knowledge`, `POST /knowledge/upload`, `POST /knowledge/website`, `DELETE /knowledge/:id` | 3 |
| `/app/knowledge/[sourceId]` | Does not exist | KB source detail: content preview, chunk list, embedding status, edit, delete | `GET /knowledge/:id`, `PUT /knowledge/:id`, `DELETE /knowledge/:id` | 3 |
| `/app/widget` | Template Widget Studio (two-pane controls + browser-chrome preview) | Keep layout; wire controls + preview to API. Three-tab control panel (Design/Content/Behavior), desktop/mobile toggle, branding, greeting, suggestions, position, confidence threshold slider. | `GET /widget-settings/:agentId`, `PUT /widget-settings/:agentId`, `GET /sections/:agentId`, `POST /sections/:agentId`, `PATCH /sections/:id`, `DELETE /sections/:id` | 3 |
| `/app/websites` | Template website list + embed snippet (mock) | Wire CRUD + per-site embed code generator + allowed origins | `GET /websites`, `POST /websites`, `PATCH /websites/:id`, `DELETE /websites/:id` | 4 |
| `/app/ai` | Template AI agent config (mock prompt + tools) | Per-agent system prompt, model selection, confidence threshold, tool toggles. **First-run empty state is a `CreateAgentForm` (name + welcome message) that POSTs `/agents`, not a "use the API" placeholder.** | `GET /agents`, `POST /agents`, `GET /agents/:id`, `PATCH /agents/:id` | 3 |
| `/app/usage` | Template usage meters (mock) | Wire to subscription usage counters (AI msg/month, KB sources, crawled pages) | `GET /billing/subscription` (returns `usage` block) | 4 |
| `/app/analytics` | Template charts (mock channels, KPIs) | Real analytics: conversations over time, resolution rate, top queries | `GET /analytics/{conversations-daily,volume,feedback,knowledge-gaps}`, `GET /billing/usage/daily` | 4 |
| `/app/analytics/rag` | Does not exist | **RAG Quality.** Production retrieval and generation health over the `RagTurnMetric` data ([`39-rag-evaluation.md`](39-rag-evaluation.md)). Five sections: KPI row with period-over-period deltas; retrieval (Recall@K / Precision@K / MRR with a K selector, and a score histogram drawing the live `AI_KB_SEARCH_MIN_SCORE` as a threshold line); generation over time plus unsupported-claim examples linking to their conversation; knowledge health (failing queries joined to `KnowledgeGap`, never-retrieved sources, failing ingestion from P8); offline eval history. **Every tile carries its definition in a click-opened popover**, served from the API so it cannot drift from the offline harness. Read-only: no write path anywhere | `GET /rag-metrics/{summary,retrieval,generation,cost,failing-queries,source-health,eval-runs,definitions}` | 4 |
| `/app/billing` | Template plan tiles + invoices (mock) | Paddle subscription status, upgrade/downgrade, invoices | `GET /billing/subscription`, `POST /billing/checkout`, `POST /billing/portal` | 4 |
| `/app/settings` | Template tabbed settings form | Org settings (name, timezone), user profile, security, team (sub-tab), API keys, danger zone | `GET /orgs/current`, `PATCH /orgs/current`, `PATCH /auth/profile`, team mgmt endpoints | 4 |
| `/app/leads` | Template lead list (mock contacts) | Contact sessions with email/phone, conversation counts | `GET /leads?websiteId=...&hasEmail=true` | 3 |
| `/app/team` | Not in template — render inside Settings | Team tab in `/app/settings`: member list, invite, role change, remove | `GET /orgs/current/members`, `POST /orgs/current/members/invite`, `PATCH /orgs/current/members/:id`, `DELETE /orgs/current/members/:id` | 4 |
| `/app/developers` | Does not exist | Create: embed code docs, copy-paste snippets (HTML/React/Next.js), API key management. **Scoped to the active website** (shows a "pick a website" prompt when scope is All). Snippets carry only `data-agent` + the saved Widget Studio cosmetics (`data-position`/`data-primary-color`/`data-theme`); org/website are derived from the agent server-side. | `GET /agents?websiteId=…`, `GET /widget-settings/:agentId` (for building embed snippet) | 3 |

---

## Platform Admin Pages (Protected `/admin/*`, `role=platform_admin` only)

| Route | Current State | Target | API Endpoints | Phase |
|-------|---------------|--------|---------------|-------|
| `/admin` | Template KPI dashboard (mock platform stats) | Cross-org KPIs, recent signups, MRR | `GET /admin/stats` | 4 |
| `/admin/users` | Template user table (mock) | Platform-wide user list, search, role change, suspend | `GET /admin/users`, `PATCH /admin/users/:id` | 4 |
| `/admin/subscribers` | Template subscriber list (mock) | Subscribers across all orgs with plan/MRR/status | `GET /admin/subscribers` | 4 |
| `/admin/subscriptions` | Template subscription list (mock) | Subscription management (manual upgrade/refund/cancel) | `GET /admin/subscriptions`, `PATCH /admin/subscriptions/:id` | 4 |
| `/admin/analytics` | Template platform analytics page | Cross-org growth, retention, feature usage | `GET /admin/analytics?period=` | 4 |
| `/admin/settings` | Template tabbed settings form | Platform settings: feature flags, default plans, system limits | `GET /admin/settings`, `PATCH /admin/settings` | 4 |

> Admin routes live under `apps/web/src/app/(admin)/admin/*` and share `AdminShell`. All routes guarded by `requirePlatformAdmin` server-side check. Non-platform-admins receive a 404 (not 403, to avoid revealing the route).

---

## Widget Pages (iframe at `apps/widget`)

| Route | Current State | Target | API Endpoints | Phase |
|-------|---------------|--------|---------------|-------|
| `/` (widget root) | Does not exist | Widget shell: state machine router → pre-chat / chat / contact / sections / resolved | `GET /widget/settings`, `POST /widget/sessions`, `POST /widget/conversations`, `GET /widget/conversations/:id/messages`, `POST /widget/conversations/:id/messages`, `POST /widget/sessions/:id/contact`, Socket.io | 2 |

---

## Dashboard Layout Component

### Sidebar Navigation (Target State)

Source: `src/components/layouts/app-shell.tsx` `nav` array. The current template groups items into **Workspace / Configure / Account**; the post-migration version keeps the same groups, deletes `Live chat`, and adds `Developers`.

```
┌─────────────────────────┐
│  🤖 Website scope switch │ ← Org name = fixed label; dropdown = "All websites"
│                         │   or one website. Sets the `csb_website` cookie which
│                         │   server components read to scope inbox/overview data.
│                         │   (NOT an org switcher — one account = one workspace.)
├─────────────────────────┤
│  WORKSPACE              │
│  📊 Overview            │ → /app
│  🌐 Websites            │ → /app/websites
│  📥 Inbox          (12) │ → /app/inbox  (badge = unread count)
│  ❌ Live chat           │ ← REMOVED (template entry deleted)
│  👥 Leads           (4) │ → /app/leads  (badge = new leads)
├─────────────────────────┤
│  CONFIGURE              │
│  ✨ AI agent            │ → /app/ai
│  🎨 Widget              │ → /app/widget
│  📚 Knowledge           │ → /app/knowledge
│  🔧 Developers          │ → /app/developers   ← ADD (new in v1)
├─────────────────────────┤
│  ACCOUNT                │
│  📈 Analytics           │ → /app/analytics
│  🎯 RAG Quality         │ → /app/analytics/rag  ← ADD (new in v1)
│  📏 Usage               │ → /app/usage
│  💳 Billing             │ → /app/billing
│  ⚙️ Settings            │ → /app/settings (team is a sub-tab)
├─────────────────────────┤
│  ← Back to website      │ → /
└─────────────────────────┘
```

### Admin Sidebar (`/admin/*`)

```
┌─────────────────────────┐
│  resolve-ai  [ADMIN]          │
├─────────────────────────┤
│  📊 Dashboard           │ → /admin
│  👥 Users               │ → /admin/users
│  💳 Subscribers         │ → /admin/subscribers
│  💰 Subscriptions       │ → /admin/subscriptions  ← ADD to nav[]
│  📈 Analytics           │ → /admin/analytics      ← ADD to nav[]
│  ⚙️ Settings            │ → /admin/settings
├─────────────────────────┤
│  ← Back to app          │ → /app
└─────────────────────────┘
```

### Changes from Current

| Item | Current (template) | Target |
|------|--------------------|--------|
| Live chat | Present in sidebar (`/app/chat`) | **Removed** — inbox is the chat UI |
| Inbox | Mock conversation list | Wired to API + Socket.io |
| Workspace switcher | Mock `workspaces[]` array in `AppShell` | Real session-backed orgs/memberships |
| User menu | Hardcoded "Maya Okafor" placeholder | NextAuth session data |
| Developers | Not present | New section (Phase 3) |
| Team | Not present | Sub-tab inside `/app/settings` |
| Unread badge | Hardcoded `12` | Real count driven by Socket.io |
| Admin: Subscriptions, Analytics | Routes exist; sidebar entries missing | Add to `AdminShell` nav |

---

## Shared Components (from existing template)

Components to **reuse** from the current `resolve-ai` template. Full inventory in [17-template-asset-inventory.md](./17-template-asset-inventory.md) §4.

| Component | Current Location | Target Location | Reuse? |
|-----------|------------------|-----------------|--------|
| App shell (sidebar + header) | `src/components/layouts/app-shell.tsx` | `apps/web/src/components/dashboard/AppShell.tsx` | ✅ Modify (remove `Live chat` nav entry, unused `MessageSquare` import, replace mock workspace/user data with session) |
| Admin shell | `src/components/layouts/admin-shell.tsx` | `apps/web/src/components/admin/AdminShell.tsx` | ✅ Modify (add Subscriptions + Analytics nav entries) |
| Marketing shell (header+footer) | `src/components/site/MarketingShell.tsx` | `apps/web/src/app/(marketing)/layout.tsx` | ✅ As-is |
| Site header | `src/components/site/SiteHeader.tsx` | `apps/web/src/components/marketing/SiteHeader.tsx` | ✅ As-is |
| Site footer | `src/components/site/SiteFooter.tsx` | `apps/web/src/components/marketing/SiteFooter.tsx` | ✅ As-is |
| Logo | `src/components/site/Logo.tsx` | `apps/web/src/components/marketing/Logo.tsx` | ✅ As-is |
| Theme provider | `src/components/theme-provider.tsx` | `apps/web/src/components/theme/ThemeProvider.tsx` | ✅ As-is (cookie-driven) |
| Theme toggle | `src/components/theme-toggle.tsx` | `apps/web/src/components/theme/ThemeToggle.tsx` | ✅ As-is |
| Landing template (`ns/*`) | `src/components/ns/**` | `apps/web/src/components/marketing/**` | ✅ Modify (swap copy + screenshots) |
| Auth heroes | `src/components/ns/authentication/{LoginHero,SignupHero,SocialAuth}.tsx` | `apps/web/src/components/auth/*` | ✅ Modify (`SocialAuth` wires to NextAuth) |
| All shadcn primitives (40) | `src/components/ui/*` | `packages/ui/src/components/*` | ✅ As-is — see §17 §4.5 |
| `cn()` util | `src/lib/utils.ts` | `packages/ui/src/lib/utils.ts` | ✅ As-is |
| `useIsMobile` hook | `src/hooks/use-mobile.tsx` | `packages/ui/src/hooks/use-mobile.tsx` | ✅ As-is |
| Global tokens | `src/app/globals.css` | `apps/web/src/app/globals.css` + extract tokens to `packages/ui/src/styles/tokens.css` | ✅ Modify (extract token block) |

---

## Echo Reference Patterns (Behavior Only — Not Code)

Behaviors to replicate from the Echo reference implementation:

| Feature | Echo Pattern | Our Implementation |
|---------|--------------|-------------------|
| Widget iframe | Separate app, loaded via embed script | `apps/widget` (Next.js) + `apps/embed` (Vite) |
| Conversation inbox | Thread list + detail view | `/app/inbox` + `/app/inbox/[conversationId]` |
| Operator reply | Reply in thread, same UI as customer view | Composer in thread view |
| Escalate/resolve | Tool calls + operator buttons | AI tools + operator buttons + Socket.io |
| KB file upload | Upload → process → embeddings | Upload → extract → chunk → Pinecone |
| Widget settings | Config panel → live preview | `/app/widget` → customization form |
| Contact sessions | Session-based identity | `contactSessionId` + localStorage |
| Embed script | Script tag with data attributes | `<script data-organization-id="..." ...>` |

**Not replicated from Echo**: Convex (we use MongoDB), Clerk (we use NextAuth), their specific component library (we use shadcn).
