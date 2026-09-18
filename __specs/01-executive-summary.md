# 01 — Executive Summary

## Product One-Liner

A multi-tenant AI customer-support SaaS that lets any business embed a chat widget on their website, powered by a shared AI agent with organization-scoped knowledge bases, and managed through an operator dashboard with real-time inbox, analytics, and billing.

---

## Three Components

### 1. Chat Widget (`apps/widget` + `apps/embed`)
- **Users**: End customers visiting a business's website
- **Surface**: Embedded iframe loaded via `<script>` tag
- **Core flow**: Customer opens widget → starts conversation with AI → provides contact info(required) → continues chat → conversation resolved by AI or escalated to human operator
- **Key properties**:
  - Conversation-first (Initial user chat message before contact capture)
  - Session-based identity via `contactSessionId` (24h TTL, localStorage)
  - Email/phone stored for CRM, never used as conversation key
  - File attachments and emoji picker in composer
  - Pre-chat screen with customizable greeting (hidden once conversation starts)
  - Sections page for quick navigation links

### 2. Operator Dashboard (`apps/web` → `/app/*`)
- **Users**: Support agents and organization administrators
- **Surface**: Next.js web application with authenticated routes
- **Core flow**: Operator logs in → views inbox → opens conversation thread → replies (with optional AI enhancement) → resolves or escalates
- **Key features**:
  - Unified inbox (no separate "Live chat" page)
  - Real-time message updates via Socket.io
  - Knowledge base CRUD (text, PDF, image, HTML, website URL)
  - Widget customization and agent settings
  - Website management with workspace filtering
  - Analytics dashboard
  - Billing management (Paddle)
  - Team/member management

### 3. Developer Toolkit (`apps/embed` + docs in `apps/web`)
- **Users**: Developers embedding the widget on their sites
- **Surface**: Documentation page + embed script generator
- **Core flow**: Developer signs up → creates agent → gets embed snippet → pastes on site → widget works
- **Key features**:
  - Copy-paste embed snippets (HTML, React, Next.js)
  - Organization/agent/website ID configuration
  - CORS and allowed origins management
  - Local dev vs production CDN URL switching
  - Optional `data-user-id` for metadata tracking

---

## Target Users

| User Type | Entry Point | Auth Method |
|-----------|-------------|-------------|
| End Customer | Chat widget on business website | Contact session token (24h, localStorage) |
| Support Operator | Dashboard login (`/login`) | NextAuth (Google OAuth + email/password) |
| Organization Admin | Dashboard login (`/login`) | NextAuth (Google OAuth + email/password) |
| Platform Admin | Dashboard login (`/login`) | NextAuth + platform admin role |
| Developer | Dashboard + docs (`/developers`) | NextAuth (same as operator) |

---

## Monorepo Layout (Summary)

```
resolve-ai/
├── apps/
│   ├── web/           # Next.js — marketing + operator dashboard + developer docs
│   ├── widget/        # Next.js — customer chat iframe (port 3001)
│   ├── embed/         # Vite — widget.js loader script (port 3002)
│   └── api/           # Express + Socket.io + background workers (port 4000)
├── packages/
│   ├── ui/            # Shared shadcn/ui components
│   ├── shared-types/  # TypeScript interfaces shared across apps
│   └── config/        # Shared ESLint, TypeScript, Tailwind configs
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── .env.example
```

---

## Technology Stack

| Layer | Technology | Version Target |
|-------|-----------|----------------|
| Monorepo | pnpm + Turborepo | Latest stable |
| Frontend framework | Next.js (App Router) | 15+ |
| UI library | React | 19+ |
| Styling | Tailwind CSS | 4+ |
| Component library | shadcn/ui | Latest |
| Backend | Express + TypeScript | 5.x / 5.x |
| Database | MongoDB (Mongoose) | 7.x / 8.x |
| Vector DB | Pinecone | Latest SDK |
| Web scraping | Firecrawl | Latest SDK |
| Realtime | Socket.io | 4.x |
| Auth (operators) | NextAuth.js | 5.x (Auth.js) |
| Auth (widget) | Custom JWT session tokens | — |
| Billing | Paddle (Billing API v2) | Latest |
| Email | Nodemailer (SMTP) | Latest |
| AI/LLM | OpenRouter / OpenAI-compatible | — |
| Validation | Joi | Latest |
| Logging | Winston + daily-rotate-file | Latest |
| Security | Helmet, CORS, bcrypt | Latest |
| Rate limiting | express-rate-limit | Latest |

---

## Non-Goals (v1)

- Mobile native apps (widget is responsive web)
- Self-hosted / on-premise deployment
- Multi-language AI agent (English only in v1)
- Voice/video calls (text chat only)
- Marketplace / third-party integrations (beyond embed)
- White-label reselling
