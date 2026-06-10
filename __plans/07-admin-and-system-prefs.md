# Phase 6 — Admin Panel Completion & Global System Preferences

> Spec: [`__specs/23-admin-and-system-preferences.md`](../__specs/23-admin-and-system-preferences.md). Backlog #1, #2. **Gap-fill** over an existing admin panel — do not rebuild what exists.

## Goal

Complete the platform admin panel (add the missing **Organizations** and **Agents** views) and add a **global app-font** system preference, configurable in `/admin/settings`, that applies consistently across `/app`, `/admin`, and public marketing pages — defaulting to the current Inter/Inter Tight so nothing changes visually until an admin picks a new font.

## Prerequisites

- Existing admin panel + `requirePlatformAdmin` guard (already shipped).
- `PlatformSetting` singleton model + `/admin/settings` GET/PATCH (already shipped).
- A `platform_admin` user to test with (`mongo-mcp`: set `User.role`).

## Skills to invoke

- [[__skills/express-mongoose-scaffold]] — `/admin/agents` route + `PlatformSetting.theming`.
- [[__skills/nextjs16-template-migration]] — new admin pages within the `(admin)` group (verify Next 16 APIs in `node_modules/next/dist/docs/`).
- [[__skills/webapp-testing]] — admin-gating + render verification.

## Work breakdown (ordered)

### Admin gaps

| # | Task | Files | Skill | Acceptance |
|---|------|-------|-------|------------|
| 1 | Organizations page consuming existing `GET /admin/organizations` (table + cursor "load more" + nav item) | `apps/web/src/app/(admin)/admin/organizations/page.tsx`, `apps/web/src/components/layouts/admin-shell.tsx` | nextjs16-template-migration | Lists orgs w/ plan + aggregates; admin-only (404 otherwise) |
| 2 | `GET /admin/agents` — cross-tenant paginated agents (org name, domain, isActive, model, conv count) via `$lookup`, mirroring `/admin/organizations` | `apps/api/src/routes/admin.routes.ts` | express-mongoose-scaffold | `requirePlatformAdmin`; returns aggregated rows; non-admin → 403 |
| 3 | Agents page + nav item | `apps/web/src/app/(admin)/admin/agents/page.tsx`, `admin-shell.tsx` | nextjs16-template-migration | Lists all agents across orgs; links to owning org |

### Global font preference

> **Updated by Changelog 30** — the curated registry grew to **~97 popular Google
> fonts** and is now **generated** ([`scripts/fonts-list.json`](../scripts/fonts-list.json)
> + [`scripts/gen-fonts.mjs`](../scripts/gen-fonts.mjs) → `fonts.ts` in all 3 apps +
> the API [`font-keys.ts`](../apps/api/src/lib/font-keys.ts)). The picker is a
> **searchable combobox** (each option in its own font), the font now also applies
> to **the widget**, and marketing pages obey it on every text/link/button/form.
> Two-slot architecture and `inter`/`inter-tight` defaults unchanged. See
> [`__specs/23-admin-and-system-preferences.md`](../__specs/23-admin-and-system-preferences.md)
> (Decisions → Changelog 30) and [`CHANGELOGS_30.md`](../CHANGELOGS_30.md).

| # | Task | Files | Skill | Acceptance |
|---|------|-------|-------|------------|
| 4 | Curated `next/font` registry of popular Google fonts — sans (Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Raleway, Nunito, Work Sans, Source Sans 3, Rubik, DM Sans, Manrope, Plus Jakarta Sans, Mulish, Figtree) + display (Inter Tight, Montserrat, Poppins, Playfair Display, Lora, Merriweather, Raleway, Oswald, Space Grotesk, Sora, Archivo, DM Serif Display), each exposing a CSS variable | `apps/web/src/app/fonts.ts`, `apps/admin/src/app/fonts.ts` (kept in sync) | nextjs16-template-migration | Module exports `{key → fontObject}` for sans + display sets |
| 5 | Add `theming.{fontSans,fontDisplay}` (enum of curated keys, default `inter`/`inter-tight`) to `PlatformSetting`; extend admin settings Zod schema + `$set`; seed default on first read | `apps/api/src/models/PlatformSetting.ts`, `apps/api/src/routes/admin.routes.ts` | express-mongoose-scaffold | `GET /admin/settings` returns `theming` defaults; PATCH validates enum |
| 6 | Root layout reads `PlatformSetting` server-side, applies selected font variables to `<html>`; `revalidateTag("platform-settings")` on settings PATCH | `apps/web/src/app/layout.tsx`, `apps/api`/web settings save path | nextjs16-template-migration | Chosen font variables present on `<html>`; default reproduces current look |
| 7 | `.ns-theme` consumes `--font-sans`/`--font-display` instead of hard-coded Inter Tight | `apps/web/src/app/globals.css` | — | Public pages follow the global font |
| 8 | System Preferences page: two font dropdown selects (body + heading) listing every curated font, with a live preview panel | `apps/admin/src/components/font-preferences.tsx`, `apps/admin/src/app/(admin)/settings/page.tsx` | nextjs16-template-migration | Selecting a font updates the live preview instantly; saving updates the global font across `/app`, `/admin`, public |

### Wrap-up

| # | Task | Files | Acceptance |
|---|------|-------|------------|
| 9 | Update spec 23 + this plan with deltas; append to `CHANGELOGS_*.md` | `__specs/23-*`, `__plans/07-*`, `CHANGELOGS_*.md` | Docs match shipped behavior |

## Decisions baked in (from spec)
- Curated font list (not arbitrary) to preserve `next/font` optimization; default = current Inter/Inter Tight.
- Global (platform-level) font, not per-org. Admin views are read-only (no cross-tenant mutations).

## Open questions (default if unanswered)
- **O1** Public `.ns-theme` inherits the global font → **yes** (keep its colors, unify font).
- **O2** Custom uploaded font files → out of scope.

## Verification
- [ ] `/admin/organizations` + `/admin/agents` render real cross-tenant data; both admin-gated (404/403 for non-admins, `mongo-mcp` to flip role).
- [ ] Theming tab changes global font; verified on a `/app` page, an `/admin` page, and a public page; default seed = current look.
- [ ] `pnpm build` + `type-check` + `test` green; `chrome-devtools-mcp` zero console errors on new pages.

## Out of scope (defer)
- Per-org theming, custom font upload, admin cross-tenant mutations, org/agent detail drill-ins.
