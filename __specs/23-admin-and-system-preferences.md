# 23 — Admin Panel Completion & Global System Preferences

## Overview

Backlog items #1 (admin panel) and #2 (global app-font system preference). **Most of the admin panel already exists** — this spec is a gap-fill, not a greenfield build. Plan: [`__plans/07-admin-and-system-prefs.md`](../__plans/07-admin-and-system-prefs.md).

The admin panel is the standalone `apps/admin` Next.js app, gated to `User.role === "platform_admin"`. Backed by cross-tenant `/admin/*` API routes ([`apps/api/src/routes/admin.routes.ts`](../apps/api/src/routes/admin.routes.ts)) guarded by `requireAuth + requirePlatformAdmin`.

**Session integrity:** when an `/admin/*` call returns **401** (token stale / account wiped) or **403** (platform-admin rights revoked), the admin API client redirects to a `/logout` Route Handler that clears the NextAuth cookie before `/login` — instead of rendering "Failed to load …". List/detail pages must re-throw non-`ApiError` errors in their `load()` `catch` so that redirect propagates (a bare catch would swallow it and show the error string).

## Current state vs. requested

| Requested admin section | Status | Evidence |
|---|---|---|
| Dashboard | ✅ exists | `(admin)/admin/page.tsx` — KPIs from `/admin/stats`, `/admin/timeseries` |
| Users | ✅ exists | `(admin)/admin/users/page.tsx` — `/admin/users` |
| Subscriptions | ✅ exists | `admin/subscriptions` + `admin/subscribers` — `/admin/subscriptions` |
| Metrics / Analytics | ✅ exists | `admin/analytics/page.tsx` — `/admin/timeseries` |
| Global app settings | ✅ exists (partial) | `admin/settings` + `PlatformSetting` singleton (smtp/security/limits/branding) |
| **Organizations** | ⚠️ API only, **no page** | `GET /admin/organizations` exists (paginated, aggregated); no `admin/organizations/page.tsx` |
| **Agents** | ❌ missing | No cross-org agents list page or `/admin/agents` API |
| **Global app font** (#2) | ❌ missing | Fonts hard-bound in `apps/web/src/app/layout.tsx` via `next/font` (`Inter`, `Inter_Tight`); no DB-driven value |

So the work is: **add Organizations page, add Agents page + API, and add a global-font system preference** wired from `PlatformSetting` into the root layout (applied to `/app`, `/admin`, and public `.ns-theme` pages).

## Roles (unchanged, reused)
- Platform: `User.role ∈ {user, platform_admin}` ([`User.ts`](../apps/api/src/models/User.ts)).
- Org-scoped: `Membership.role ∈ {owner, admin, agent, viewer}`.
- API guard: `requirePlatformAdmin` ([`auth.middleware.ts`](../apps/api/src/middleware/auth.middleware.ts)); web guard: admin `layout.tsx`.

---

## Feature 1 — Fill admin panel gaps

### 1a. Organizations page
- New page `(admin)/admin/organizations/page.tsx` consuming the **existing** `GET /admin/organizations` (cursor-paginated; returns members, conversations, KB sources, subscription plan per org).
- Columns: org name/slug, plan badge, members, conversations, KB sources, created. Cursor "load more". Row → drill-in (defer detail page).
- Add nav item to [`admin-shell.tsx`](../apps/web/src/components/layouts/admin-shell.tsx).

### 1b. Agents page
- New `GET /admin/agents` (cross-tenant, `requirePlatformAdmin`): paginated agents with org name, website domain, `isActive`, model, conversation count (aggregate via `$lookup` like `/admin/organizations`).
- New page `(admin)/admin/agents/page.tsx`: table of all agents across orgs; filter by active; link to owning org.
- Add nav item.

### Decisions
- Reuse the aggregation/pagination pattern already in `admin.routes.ts` (`/admin/organizations`); no new pagination abstraction.
- Read-only views first; no cross-tenant mutation from admin (avoids RLS-bypass risk). Mutations (suspend org, deactivate agent) are an explicit out-of-scope follow-up.

---

## Feature 2 — Global app font (system preference)

### Problem
Fonts are compiled into [`apps/web/src/app/layout.tsx`](../apps/web/src/app/layout.tsx) by `next/font/google` (`Inter` body, `Inter_Tight` display) exposed as CSS vars `--font-inter` / `--font-inter-tight`, mapped in [`globals.css`](../apps/web/src/app/globals.css) to `--font-sans` / `--font-display`. `next/font` is **build-time**: you can't feed it an arbitrary runtime string. Public marketing pages use a `.ns-theme` scope that overrides the display font.

### Design
Offer a **curated set** of fonts (not arbitrary), so we keep `next/font` optimization while letting the admin choose:
- Pre-import N curated Google fonts via `next/font` in a `fonts.ts` module, each exposing a CSS variable. Default = current Inter / Inter_Tight (set as the seeded value so behavior is unchanged on day one).
- Store the choice in `PlatformSetting.theming` (new sub-schema): `{ fontSans: "inter", fontDisplay: "inter-tight" }` (enum of curated keys).
- Root `layout.tsx` (server component) reads `PlatformSetting` once, selects the matching pre-imported font objects, and applies their `variable` classes to `<html>`; `globals.css` keeps mapping `--font-sans`/`--font-display`. `.ns-theme` is updated to consume `--font-display`/`--font-sans` instead of hard-coding Inter Tight, so public pages follow the same choice ("consistent app font everywhere").
- Admin UI: the `/admin/settings` ("System Preferences") page renders [`FontPreferences`](../apps/admin/src/components/font-preferences.tsx) — two dropdown selects (body, heading) listing every curated font, each with a **live sample aligned to its right** that re-renders in the selected font as you pick, before saving.

### Decisions

> **Changelog 30 — ~100 fonts, generated registry, searchable picker, widget + marketing.**
> The curated registry grew from 20 to **~97 popular Google fonts** (Google Fonts
> popularity ∩ `@fontsource` availability, Latin-capable, variable-preferred), still
> self-hosted via `@fontsource[-variable]` + `next/font/local` (build never fetches
> Google Fonts). The two-slot architecture (CL19–20) is unchanged.
> - The registry is now **generated**: [`scripts/fonts-list.json`](../scripts/fonts-list.json)
>   (curated list) + [`scripts/gen-fonts.mjs`](../scripts/gen-fonts.mjs) scans the
>   installed packages and writes an identical `fonts.ts` into all three apps plus
>   the API's [`font-keys.ts`](../apps/api/src/lib/font-keys.ts) (the Zod-enum
>   source). To change the set: edit `fonts-list.json`, `pnpm add` new packages,
>   run `node scripts/gen-fonts.mjs`. Hand-editing `fonts.ts` is no longer the path.
> - [`FontPreferences`](../apps/admin/src/components/font-preferences.tsx) is now two
>   **searchable comboboxes** (Popover + cmdk `Command`); each option renders in its
>   own font, with a live preview. `settings-real.tsx`'s Theming tab lists the same
>   ~100 fonts (imported from the registry).
> - The **widget** now loads the selected font too
>   (`apps/widget/src/app/{fonts.ts,layout.tsx,globals.css}`), reading the admin
>   choice from `/public/theming` (graceful fallback) — so the font is consistent on
>   the widget as well as admin / `/app` / marketing.
> - Marketing `.ns-theme` follows `--font-sans`/`--font-display`; no component
>   hard-codes a family and Tailwind preflight makes links/buttons/form controls
>   inherit, so **every** text/link/button/form element obeys the chosen font.
> - Base type size bumped to `html { font-size: 115% }` (web + admin); landing body
>   copy (`.ns-theme p`) enlarged to ~1–1.125rem for a chatbase.co-like scale.
> - `theming.fontSans`/`fontDisplay` keep family keys (default `inter`/`inter-tight`).
>
> The CL19–20 notes below are retained for history; the font *count* and the
> hand-edit workflow are superseded by the generated registry above.

- **Curated list (self-hosted via @fontsource + `next/font/local`)**: a popular set — body/sans (Inter, **Geist, DM Sans, Plus Jakarta Sans, Manrope, Sora, Space Grotesk, IBM Plex Sans**, Roboto, Open Sans, Lato, Montserrat, Poppins, Nunito, Work Sans) and heading/display (Inter Tight, **Geist, Sora, Space Grotesk**, Montserrat, Poppins, Playfair Display, Lora, Merriweather, Oswald). _(Bolded fonts added in Changelog 19.)_ The fonts are vendored as `@fontsource[-variable]` npm packages and loaded with `next/font/local` so the **build never fetches Google Fonts** (that made the Docker/Coolify build fail intermittently). The canonical list lives in `apps/{web,admin}/src/app/fonts.ts`; the API enum in `admin.routes.ts` mirrors its keys. To add a font: `pnpm add --filter @csb/{web,admin} @fontsource[-variable]/<name>`, add a `localFont()` entry + key in both `fonts.ts`, and the enum key.
- **`admin/fonts.ts` was stale** _(fixed Changelog 19)_: it still used `next/font/google` with only ~3 fonts per slot (never migrated to the `@fontsource` local set like web), so a chosen platform font frequently failed to apply on admin pages. Now synced verbatim to the web registry. Keep the two files identical.
- **Unified body + title options** _(Changelog 20)_: the body and heading selects now offer the **same** list. `fonts.ts` declares every font twice — once for the body slot (`variable: --font-inter`) and once for the heading slot (`variable: --font-inter-tight`) — because next/font only loads a font when its `.variable` className is applied. A single `FONT_OPTIONS` list backs both selects (aliased to `SANS_OPTIONS`/`DISPLAY_OPTIONS`), and the API enum is a single `FONT_KEYS` for both `fontSans`/`fontDisplay`. Current set (20, popular website fonts): Inter, Inter Tight, Geist, DM Sans, Plus Jakarta Sans, Manrope, Sora, Space Grotesk, IBM Plex Sans, Roboto, Open Sans, Lato, Montserrat, Poppins, Nunito, Work Sans, Lora, Merriweather, Playfair Display, Oswald.
- **Only the selected fonts are fetched** _(Changelog 5, agentic batch)_: the registry declares ~97 fonts × 2 slots, and `next/font/local` defaults to `preload: true` — which emitted a `<link rel="preload" as="font">` for **every** declared font, so each page (landing included) downloaded the whole registry up front, not just the applied ones. The generator [`scripts/gen-fonts.mjs`](../scripts/gen-fonts.mjs) now emits **`preload: false`** on every declaration; the `@font-face` rules are still generated but a font's woff2 is only fetched when its `.variable` is actually applied (the admin-selected or default `inter`/`inter-tight` header/body). `display:'swap'` covers the brief fallback. Verified in-browser: the landing page loads 2 text fonts, not ~97.
- **Base type size** _(Changelog 19)_: `html { font-size: 112.5% }` (16px → 18px, ~12%) in [web](../apps/web/src/app/globals.css) + [admin](../apps/admin/src/app/globals.css) `globals.css` scales all rem-based text proportionally; px widths stay fixed. The widget keeps its own sizing (fixed-size panel, not a platform-font surface).
- **Reflecting changes in production** _(Changelog 21–22)_: the layout's theming fetch must use **`API_INTERNAL_URL`** (server-side; the public `localhost` URL points at the container itself) and **`cache: 'no-store'`** (CL22). With ISR `revalidate`, a production build baked the build-time font into static pages and a later change never appeared; `no-store` reads the current setting per request. `NEXT_PUBLIC_APP_NAME` must be in each app's `.env.local` (host `pnpm build` ignores the root `.env`) and a build ARG in each app's Dockerfile + compose args (Docker path).
- **Default = current** (Inter / Inter Tight) seeded into `PlatformSetting.theming` so existing visuals are identical until changed (satisfies "current font as default value").
- Font choice is **global/platform-level** (one font for the whole product), matching "global app font" — not per-org. (Per-org theming is a separate, larger item; noted out-of-scope.)
- Layout reads the singleton server-side; revalidate/caching: tag the read so a settings save busts it (Next `revalidateTag`), or accept next-request freshness. Default: `revalidateTag("platform-settings")` on PATCH.

### Open questions
- O1: Should the public marketing `.ns-theme` truly inherit the admin font, given its bespoke visual identity? → Default: **yes** (the requirement says "consistent app font everywhere"); keep `.ns-theme` color identity, only unify the font family.
- O2: Allow uploading a custom/self-hosted font file? → Out of scope; curated list only.

### Files
- [`apps/api/src/models/PlatformSetting.ts`](../apps/api/src/models/PlatformSetting.ts) — add `theming.{fontSans,fontDisplay}`.
- [`apps/api/src/routes/admin.routes.ts`](../apps/api/src/routes/admin.routes.ts) — extend settings Zod schema + `$set`; add `GET /admin/agents`.
- `apps/web/src/app/fonts.ts` (new) — curated `next/font` registry.
- [`apps/web/src/app/layout.tsx`](../apps/web/src/app/layout.tsx) — read setting, apply selected variables.
- [`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css) — `.ns-theme` consumes `--font-*` vars. **(Changelog 18)** This was previously incomplete: `.ns-theme` body **and** headings hard-coded `var(--font-inter-tight)`, so marketing followed only the chosen display font and ignored the body font. Now body → `--font-sans`, headings → `--font-display`, so the System-Preferences font truly applies on every surface.
- `(admin)/admin/organizations/page.tsx`, `(admin)/admin/agents/page.tsx` (new) + `admin-shell.tsx` nav.
- Admin settings form — add Theming tab.

---

## Feature 3 — Analytics filters _(Changelog 18, extended 19)_
The `/admin/analytics` page previously fetched a fixed `days=30` window of all three metrics. It now has URL-param filters:
- **Time range** — 7 / 30 / 90 / 180 days (`?days=`); the `/admin/timeseries` endpoint already clamps `days` to 1–180.
- **Metric** — all / signups / conversations / messages (`?metric=`); only the selected metric's chart(s) render, and the subtitle reflects the chosen range.
- **Organization** (`?organizationId=`) and **Agent** (`?agentId=`) _(Changelog 19)_ — option lists loaded server-side from `/admin/organizations` + `/admin/agents`. Backend: `adminTimeSeries` ([`analytics.service.ts`](../apps/api/src/services/analytics.service.ts)) scopes conversations by `Conversation.agentId` and messages by that agent's conversation ids (messages carry no `agentId`). Signups aren't agent-scoped. Ids are validated as ObjectIds in the route.
- _(2026-07 batch)_ **Org filtering fixed on two fronts:**
  - **Agent dropdown is scoped to the selected org.** `loadFilterOptions(organizationId)` now fetches `/admin/agents?organizationId=…` (page passes the selected org), so the Agent list only shows that org's agents. Changing the org clears any previously selected `agentId` in `analytics-filter.tsx` (it belonged to the old org).
  - **Signups now respect the org filter.** `User` has no `organizationId` (users join orgs via `Membership`), so filtering the `User` collection by `organizationId` previously matched nothing. `adminTimeSeries` now resolves the org's member `userId`s via `Membership` and matches signups on those ids. Conversations/messages were already org-scoped.
- Control: [`analytics-filter.tsx`](../apps/admin/src/components/admin/analytics-filter.tsx) + static option lists in [`analytics-options.ts`](../apps/admin/src/components/admin/analytics-options.ts) (kept out of the `'use client'` file — importing data constants from a client module into a server component yields client-reference proxies, breaking `.map`); page: [`(admin)/analytics/page.tsx`](../apps/admin/src/app/(admin)/analytics/page.tsx) (server, reads `searchParams`, `force-dynamic`).
- _(Changelog 22)_ The filters live on **their own row** below the title — selecting an org/agent lengthens the subtitle, which previously (shared `justify-between` row) wrapped the filters onto a new line.

---

## Out of scope (separate items)
- Per-organization theming / white-label fonts.
- Cross-tenant admin mutations (suspend org, force-deactivate agent, impersonation).
- Custom uploaded font files.
- Org detail drill-in pages (organizations/[id], agents/[id]).

## Acceptance
- [ ] `/admin/organizations` lists all orgs with aggregates; pagination works; admin-only (404 for non-admins).
- [ ] `/admin/agents` lists all agents across orgs; `GET /admin/agents` admin-gated.
- [ ] Admin Theming tab changes the global font; `/app`, `/admin`, and public pages all render the chosen font after save; default seed reproduces today's Inter look exactly.
- [ ] `pnpm build` + `type-check` + `test` green; zero console errors on touched admin pages (`chrome-devtools-mcp`).
