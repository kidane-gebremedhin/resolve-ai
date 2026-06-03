# 23 — Admin Panel Completion & Global System Preferences

## Overview

Backlog items #1 (admin panel) and #2 (global app-font system preference). **Most of the admin panel already exists** — this spec is a gap-fill, not a greenfield build. Plan: [`__plans/07-admin-and-system-prefs.md`](../__plans/07-admin-and-system-prefs.md).

The admin panel is a route group `(admin)/admin/*` inside the single `apps/web` Next.js app, gated to `User.role === "platform_admin"` ([`apps/web/src/app/(admin)/admin/layout.tsx`](../apps/web/src/app/(admin)/admin/layout.tsx) returns 404 for non-admins). Backed by cross-tenant `/admin/*` API routes ([`apps/api/src/routes/admin.routes.ts`](../apps/api/src/routes/admin.routes.ts)) guarded by `requireAuth + requirePlatformAdmin`.

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
- Admin UI: a "Appearance/Theming" tab in [`AdminSettingsForm`](../apps/web/src/components/layouts/admin-shell.tsx) (the `admin/settings` form) with two selects (body, heading) previewing the curated fonts.

### Decisions
- **Curated list** (initial): Inter, Inter Tight, Geist, Roboto, Open Sans, Lora (serif), JetBrains Mono (for completeness). Extendable by editing `fonts.ts`.
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
- [`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css) — `.ns-theme` consumes `--font-*` vars.
- `(admin)/admin/organizations/page.tsx`, `(admin)/admin/agents/page.tsx` (new) + `admin-shell.tsx` nav.
- Admin settings form — add Theming tab.

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
