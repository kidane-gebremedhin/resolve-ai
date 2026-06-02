# 17 — Template Asset Inventory & Migration Map

## Overview

The current `customer-service-chatbot` directory contains a **Next.js 16 marketing + dashboard template** that will be split into the monorepo defined in [02-monorepo-structure.md](./02-monorepo-structure.md). This document enumerates every existing route, layout, shared component, and public asset, and prescribes its destination in the target structure.

> **Rule**: We do **not** rewrite the template. We move the files, rename the navigation entries, delete `Live chat`, and wire the existing pages to the API defined in [07-api-specification.md](./07-api-specification.md). Visual layout, copy tone, and styling must be preserved.

---

## 1. Marketing Routes (Current → `apps/web/(marketing)`)

| Current Path | Page Component | Target Path | Action |
|--------------|----------------|-------------|--------|
| `src/app/page.tsx` | `HomePageContent` | `apps/web/src/app/(marketing)/page.tsx` | Move; replace placeholder copy/screenshots with product-specific |
| `src/app/features/page.tsx` | `FeaturesPageContent` | `apps/web/src/app/(marketing)/features/page.tsx` | Move as-is, update feature list to match product |
| `src/app/customers/page.tsx` | `CustomersPageContent` | `apps/web/src/app/(marketing)/customers/page.tsx` | Move as-is |
| `src/app/pricing/page.tsx` | `PricingPageContent` | `apps/web/src/app/(marketing)/pricing/page.tsx` | Move; wire to Paddle plan IDs |
| `src/app/contact/page.tsx` | `ContactPageContent` | `apps/web/src/app/(marketing)/contact/page.tsx` | Move; wire form to `POST /contact` |
| `src/app/login/page.tsx` | `LoginPageContent` | `apps/web/src/app/(auth)/login/page.tsx` | Move; wire `SocialAuth` to NextAuth `signIn()` |
| `src/app/signup/page.tsx` | `SignupPageContent` | `apps/web/src/app/(auth)/register/page.tsx` | Move; wire to `POST /auth/register`. **Template route `/signup` → renamed to `/register`** (canonical CTA path). |
| `src/app/not-found.tsx` | (built-in) | `apps/web/src/app/not-found.tsx` | Move as-is |
| `src/app/layout.tsx` | Root layout + `ThemeProvider` | `apps/web/src/app/layout.tsx` | Move as-is; keep cookie-based theme |

**Marketing shell**: `src/components/site/MarketingShell.tsx` (uses `SiteHeader` + `SiteFooter`) → `apps/web/src/app/(marketing)/layout.tsx`.

---

## 2. Operator Dashboard Routes (Current → `apps/web/(dashboard)/app`)

| Current Path | Action | Target Path | Wire-up |
|--------------|--------|-------------|---------|
| `src/app/app/layout.tsx` | Move | `apps/web/src/app/(dashboard)/layout.tsx` | Uses `AppShell` |
| `src/app/app/page.tsx` | Wire | `apps/web/src/app/(dashboard)/app/page.tsx` | KPI cards → `GET /analytics/overview` |
| `src/app/app/inbox/page.tsx` | Wire | `apps/web/src/app/(dashboard)/app/inbox/page.tsx` | Replace mock list → `GET /conversations` + Socket.io |
| `src/app/app/inbox/[conversationId]/page.tsx` | **Create** | (new) | Thread view (Phase 3) |
| `src/app/app/chat/page.tsx` | **DELETE** | — | `Live chat` is removed entirely |
| `src/app/app/widget/page.tsx` | Wire | `apps/web/src/app/(dashboard)/app/widget/page.tsx` | Two-pane Widget Studio → `GET/PUT /widget-settings/:agentId` |
| `src/app/app/knowledge/page.tsx` | Wire | `apps/web/src/app/(dashboard)/app/knowledge/page.tsx` | Source list → `GET /knowledge` |
| `src/app/app/knowledge/[sourceId]/page.tsx` | **Create** | (new) | Detail view (Phase 3) |
| `src/app/app/leads/page.tsx` | Wire | `apps/web/src/app/(dashboard)/app/leads/page.tsx` | Contact sessions → `GET /leads` |
| `src/app/app/websites/page.tsx` | Wire | `apps/web/src/app/(dashboard)/app/websites/page.tsx` | Website CRUD → `GET/POST/PATCH/DELETE /websites` |
| `src/app/app/ai/page.tsx` | Wire | `apps/web/src/app/(dashboard)/app/ai/page.tsx` | Agent config → `GET/PATCH /agents/:id` (per-agent system prompt) |
| `src/app/app/usage/page.tsx` | Wire | `apps/web/src/app/(dashboard)/app/usage/page.tsx` | Usage meters → `GET /billing/subscription` (returns usage counters) |
| `src/app/app/billing/page.tsx` | Wire | `apps/web/src/app/(dashboard)/app/billing/page.tsx` | Paddle checkout → `POST /billing/checkout` |
| `src/app/app/analytics/page.tsx` | Wire | `apps/web/src/app/(dashboard)/app/analytics/page.tsx` | Charts → `GET /analytics/conversations` |
| `src/app/app/settings/page.tsx` | Wire | `apps/web/src/app/(dashboard)/app/settings/page.tsx` | Org/user/team tabs → `PATCH /orgs/current`, team mgmt endpoints |
| `apps/web/src/app/(dashboard)/app/developers/page.tsx` | **Create** | (new) | Embed code generator (Phase 3) |

**Dashboard shell**: `src/components/layouts/app-shell.tsx` → `apps/web/src/components/dashboard/AppShell.tsx`. The shell must be edited to:

1. **Delete** the `Live chat` entry from the `nav` array (`{ href: '/app/chat', label: 'Live chat', icon: MessageSquare, group: 'Workspace' }`).
2. **Remove** the `MessageSquare` import that is now unused.
3. **Add** entries for `Team` and `Developers` once those pages exist.

> The mock `workspaces` array and `UserMenu` placeholder data must be replaced with real session-backed data in Phase 0 (NextAuth session) / Phase 1 (memberships API).

---

## 3. Platform Admin Routes (Current → `apps/web/(admin)/admin`)

The template ships an **admin panel** (`/admin/*`) that was not yet captured in [11-page-wiremap.md](./11-page-wiremap.md). It is the surface for platform-admin users (`users.role = platform_admin`, see [03-data-model.md](./03-data-model.md)).

| Current Path | Action | Target Path | Wire-up |
|--------------|--------|-------------|---------|
| `src/app/admin/layout.tsx` | Move | `apps/web/src/app/(admin)/layout.tsx` | Uses `AdminShell`; guarded by `platform_admin` role middleware |
| `src/app/admin/page.tsx` | Wire | `apps/web/src/app/(admin)/admin/page.tsx` | KPIs → `GET /admin/stats` |
| `src/app/admin/users/page.tsx` | Wire | `apps/web/src/app/(admin)/admin/users/page.tsx` | Platform-wide user list → `GET /admin/users` |
| `src/app/admin/subscribers/page.tsx` | Wire | `apps/web/src/app/(admin)/admin/subscribers/page.tsx` | Subscriber list → `GET /admin/subscribers` |
| `src/app/admin/subscriptions/page.tsx` | Wire | `apps/web/src/app/(admin)/admin/subscriptions/page.tsx` | Subscription mgmt → `GET /admin/subscriptions`, `PATCH /admin/subscriptions/:id` |
| `src/app/admin/analytics/page.tsx` | Wire | `apps/web/src/app/(admin)/admin/analytics/page.tsx` | Cross-org metrics → `GET /admin/analytics` |
| `src/app/admin/settings/page.tsx` | Wire | `apps/web/src/app/(admin)/admin/settings/page.tsx` | Platform settings (feature flags, default plans) → `GET/PATCH /admin/settings` |

**Admin shell**: `src/components/layouts/admin-shell.tsx` → `apps/web/src/components/admin/AdminShell.tsx`. Add `Subscriptions` and `Analytics` nav entries (they exist as routes but are missing from the current admin sidebar).

**Required new endpoints** (add to [07-api-specification.md](./07-api-specification.md) §Admin):

- `GET /admin/stats` — platform KPIs
- `GET /admin/users?q=&role=` — platform user search
- `GET /admin/subscribers` — subscribers across all orgs
- `GET /admin/subscriptions`, `PATCH /admin/subscriptions/:id` — manual subscription override
- `GET /admin/analytics?period=` — cross-org analytics
- `GET /admin/settings`, `PATCH /admin/settings` — feature flags

All admin routes require `requirePlatformAdmin` middleware (verifies `users.role === 'platform_admin'`).

---

## 4. Shared Components

### 4.1 Marketing template (`src/components/ns/*`)

A complete landing-page template lives under `ns/` (likely "Next-Sass" / "NextStarter"). It is **template-locked**: keep components, swap copy and screenshots.

| Path | Purpose | Target |
|------|---------|--------|
| `ns/home-page-content.tsx` | Landing composition | `apps/web/src/components/marketing/HomePageContent.tsx` |
| `ns/landing-page-shell.tsx`, `NSLandingShell.tsx` | Shared landing chrome | `apps/web/src/components/marketing/LandingShell.tsx` |
| `ns/ClientMarquee.tsx` | Logo marquee | `apps/web/src/components/marketing/ClientMarquee.tsx` |
| `ns/animation/RevealAnimation.tsx` | Scroll-reveal wrapper (GSAP) | `apps/web/src/components/marketing/RevealAnimation.tsx` |
| `ns/authentication/*` | Login/Signup hero + social auth | `apps/web/src/components/auth/*` |
| `ns/homepage-34/*` | Hero/About/Pricing/CTA/Feature/Steps/Services/Clients/Blog/Contact sections | `apps/web/src/components/marketing/sections/*` — **keep all 10 files** |
| `ns/pages/*` | Page-level compositions (contact, features, login, pricing, signup) | `apps/web/src/components/marketing/pages/*` |
| `ns/shared/NavbarFour.tsx` | Alt navbar (not used by `SiteHeader`) | Keep for reference; not migrated |
| `ns/shared/FooterOne.tsx` | Alt footer (not used by `SiteFooter`) | Keep for reference; not migrated |
| `ns/shared/ThemeToggle.tsx` | Marketing-style theme toggle | `apps/web/src/components/marketing/ThemeToggle.tsx` |
| `ns/shared/card/BlogCardV4.tsx`, `BlogCardV5.tsx` | Blog cards | `apps/web/src/components/marketing/BlogCard.tsx` (post-v1) |
| `ns/shared/reviews/ReviewsV1.tsx`, `GradientOverlay.tsx` | Review carousel | `apps/web/src/components/marketing/Reviews.tsx` |
| `ns/ui/button/LinkButton.tsx` | Animated link button | `apps/web/src/components/marketing/LinkButton.tsx` |
| `ns/ui/stack-card/StackCardWrapper.tsx`, `StackCardItem.tsx` | Stacked scroll cards | `apps/web/src/components/marketing/StackCard*.tsx` |

### 4.2 Product shell components (`src/components/site/*`)

| Path | Purpose | Target |
|------|---------|--------|
| `site/MarketingShell.tsx` | Header + footer wrapper | `apps/web/src/app/(marketing)/layout.tsx` (or component) |
| `site/SiteHeader.tsx` | Top nav (Features / Customers / Pricing / Contact / Sign in / Open dashboard) | `apps/web/src/components/marketing/SiteHeader.tsx` |
| `site/SiteFooter.tsx` | Footer | `apps/web/src/components/marketing/SiteFooter.tsx` |
| `site/Logo.tsx` | Wordmark | `apps/web/src/components/marketing/Logo.tsx` |
| `site/customers-page-content.tsx` | Customers page body | `apps/web/src/components/marketing/CustomersPageContent.tsx` |

### 4.3 Layout shells (`src/components/layouts/*`)

| Path | Purpose | Target |
|------|---------|--------|
| `layouts/app-shell.tsx` | Operator dashboard chrome (sidebar with `Live chat` to delete, workspace switcher, user menu) | `apps/web/src/components/dashboard/AppShell.tsx` |
| `layouts/admin-shell.tsx` | Platform admin chrome | `apps/web/src/components/admin/AdminShell.tsx` |

### 4.4 Theme system

| Path | Purpose | Target |
|------|---------|--------|
| `components/theme-provider.tsx` | Context provider, cookie persistence | `apps/web/src/components/theme/ThemeProvider.tsx` |
| `components/theme-toggle.tsx` | Top-bar toggle | `apps/web/src/components/theme/ThemeToggle.tsx` |
| `lib/theme.ts` | `parseTheme` helper + `Theme` type | `apps/web/src/lib/theme.ts` |

The cookie-driven theme system (light/dark, SSR-safe via `cookies()` in root layout) must be preserved across the move.

### 4.5 shadcn/ui (`src/components/ui/*`)

All 40 shadcn primitives currently in `src/components/ui/` go to **`packages/ui/src/components/`** unchanged:

```
accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb,
button, calendar, card, carousel, chart, checkbox, collapsible, command,
context-menu, dialog, drawer, dropdown-menu, form, hover-card, input-otp,
input, label, menubar, navigation-menu, pagination, popover, progress,
radio-group, resizable, scroll-area, select, separator, sheet, sidebar,
skeleton, slider, sonner, switch, table, tabs, textarea, toggle-group,
toggle, tooltip
```

Export every component from `packages/ui/src/index.ts`. Both `apps/web` and `apps/widget` import via `@csb/ui`.

`components.json` (shadcn config) must be copied into `packages/ui/` so future `pnpm dlx shadcn add <x>` runs in that package, not in an app.

### 4.6 Utilities, hooks, data

| Path | Purpose | Target |
|------|---------|--------|
| `lib/utils.ts` (`cn()`) | Tailwind class merger | `packages/ui/src/lib/utils.ts` |
| `hooks/use-mobile.tsx` | Breakpoint hook | `packages/ui/src/hooks/use-mobile.tsx` |
| `utils/domUtils.ts`, `ns-cn.ts`, `springer.ts`, `stackCards.ts` | ns/ helpers | `apps/web/src/lib/marketing/*` |
| `data/ns-blogs.ts`, `ns-services.ts`, `ns-testimonials.ts` | Static template data | `apps/web/src/data/marketing/*` — replace with product-specific copy |

---

## 5. Public Assets

### 5.1 Keep (move to `apps/web/public/`)

| Asset | Reason |
|-------|--------|
| `public/fonts/next-sass.{ttf,eot,svg,woff}` | Brand font (referenced by `globals.css`) |
| `public/images/authentication/` | Login/signup hero imagery |
| `public/images/features/` | Features-page screenshots/illustrations |
| `public/images/home-page-34/` | Active landing hero/section imagery (matches `homepage-34` components) |
| `public/images/icons/` | Shared icon set |
| `public/images/shared/` | Cross-page imagery |
| `public/images/our-team/` | About-page roster (if `/about` is added in Phase 4) |
| `public/images/pricing/` | Pricing-page imagery |
| `public/images/avatar/` | Default avatars (operator/AI/customer placeholders) |
| `public/images/analytics/` | Analytics-page illustrations |
| `public/images/support-page/` | Support / help imagery |

### 5.2 Drop (do not migrate)

The template ships **22 MB of gradient PNGs** under `public/images/gradient/` and **40+ unused `home-page-N/` folders** (we only use `home-page-34`). These bloat the bundle and have no consumer.

| Asset | Reason for removal |
|-------|--------------------|
| `public/images/gradient/` (22 MB) | Decorative; replace with CSS gradients in the long run. **Until then keep `gradient-{1,2,4,9,28,32,33,34,39}.png`** — they are referenced by `FooterOne`, `Pricing`, `Steps`, `Services`, `Feature`, and `GradientOverlay`; dropping them all renders the marketing layout without its background washes. |
| `public/images/home-page-{1..38}` except `home-page-34` | Not referenced by any active component |
| `public/images/blogs/` (612 KB) | Blog is post-v1 (see [11-page-wiremap.md](./11-page-wiremap.md)) |
| `public/images/case-study/` (2.4 MB) | Case-study page not in v1 |
| `public/images/career/` | Careers page not in v1 |
| `public/images/affiliates/` | Affiliates page not in v1 |
| `public/images/about-page-0{1,2,3}/` | If we ship `/about`, pick **one** set |
| `public/images/learn-page/` | Learn page not in v1 |
| `public/images/use-case-page/` | Use-cases page not in v1 |
| `public/images/process/`, `services/` | Section imagery not consumed by `homepage-34` |
| `public/{file,globe,next,vercel,window}.svg` | Next.js scaffold defaults |

**Verification rule** (Phase 0 acceptance): every file under `apps/web/public/images/` must be referenced from at least one component or stylesheet. Add a `pnpm verify:assets` script that greps the source tree for each filename and fails if unused.

### 5.3 Asset paths that the AI agent needs (Phase 2+)

| Asset | Used by |
|-------|---------|
| `public/images/avatar/ai-default.png` (new) | Widget AI message bubble |
| `public/images/avatar/operator-default.png` (new) | Widget operator message bubble |
| `public/images/widget/branding-mark.svg` (new) | "Powered by customer-service-chatbot" footer in widget (toggleable per widget settings) |

These are net-new assets needed beyond the template; cut from existing avatar imagery or new design pass.

---

## 6. Global Styles & Theme Tokens

`src/app/globals.css` defines the Tailwind 4 design tokens (`--background`, `--foreground`, `--surface`, `--muted`, `--primary`, `--border`, `--destructive`, etc.) for both light and dark themes. **Preserve verbatim** — every shadcn component and the AppShell rely on these tokens.

| Token | Used By |
|-------|---------|
| `--background` / `--foreground` | Body, all surfaces |
| `--surface` | AppShell page background, AdminShell page background |
| `--muted` / `--muted-foreground` | Sidebar hovers, secondary text |
| `--border` | All separators, card outlines |
| `--primary` | Notification dots, accent badges |
| `--destructive` | Logout link, admin badge |
| `container-page` utility class | Used by `MarketingShell` content width |

Target: `apps/web/src/app/globals.css` (move verbatim) + `packages/ui/src/styles/tokens.css` (extracted token block, imported by both `apps/web/globals.css` and `apps/widget/globals.css` so the widget inherits the same palette).

---

## 7. Migration Order (per [10-frontend-phases.md](./10-frontend-phases.md) Phase 0)

1. Scaffold `apps/web` empty Next.js shell.
2. Copy `src/components/ui/**` → `packages/ui/src/components/**`. Smoke-test build.
3. Copy `src/lib/utils.ts`, `src/lib/theme.ts`, `src/hooks/use-mobile.tsx` → corresponding `@csb/ui` paths.
4. Copy `src/app/globals.css` → `apps/web/src/app/globals.css`. Extract tokens to `packages/ui/src/styles/tokens.css`.
5. Copy `src/components/site/**` → `apps/web/src/components/marketing/**` (rename folder).
6. Copy `src/components/ns/**` → `apps/web/src/components/marketing/{sections,pages,...}` per §4.1.
7. Copy `src/components/layouts/app-shell.tsx` → `apps/web/src/components/dashboard/AppShell.tsx`. **Edit**: delete `Live chat` nav entry, remove unused `MessageSquare` import.
8. Copy `src/components/layouts/admin-shell.tsx` → `apps/web/src/components/admin/AdminShell.tsx`. Add `Subscriptions`, `Analytics` to nav.
9. Copy all marketing routes (`src/app/{page,features,customers,pricing,contact,login,signup,not-found}`) to `apps/web/src/app/(marketing)/...` / `(auth)/...`.
10. Copy all dashboard routes (`src/app/app/**`) to `apps/web/src/app/(dashboard)/app/**`. **Delete** `chat/` directory and the `/app/chat` route.
11. Copy all admin routes (`src/app/admin/**`) to `apps/web/src/app/(admin)/admin/**`.
12. Copy required public assets per §5.1. Run `pnpm verify:assets` to confirm none of the §5.2 paths are referenced.
13. `pnpm --filter @csb/web build` must succeed with zero errors before Phase 0 is considered complete.

---

## 8. Acceptance

- [ ] No reference to `/app/chat` or the string `Live chat` exists anywhere in `apps/web/`.
- [ ] All shadcn primitives import from `@csb/ui` (not `@/components/ui`).
- [ ] All marketing pages render visually identical to the current template (screenshot diff acceptable).
- [ ] Admin sidebar lists Dashboard, Users, Subscribers, **Subscriptions**, **Analytics**, Settings.
- [ ] `apps/web/public/images/` is < 5 MB (down from current ~50 MB of template imagery).
- [ ] Cookie-driven light/dark theme works on first paint (no FOUC) on every route group.
- [ ] AppShell user menu and workspace switcher render real session data (no `Maya Okafor` / `Northwind` placeholders).
