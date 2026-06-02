---
name: nextjs16-template-migration
description: Move the existing Next.js 16 + React 19 + Tailwind 4 marketing/dashboard/admin template at the repo root into apps/web/ in the new monorepo without rewriting visuals. Deletes the /app/chat ("Live chat") route. Use during Phase 0 after pnpm-turbo-monorepo has bootstrapped the workspace. Implements __specs/17-template-asset-inventory.md.
---

# Next.js 16 Template Migration

## When to use

Phase 0, **after** [`pnpm-turbo-monorepo`](../pnpm-turbo-monorepo/) but **before** any other Phase 0 skill. Visuals must remain pixel-identical — this skill moves files and edits only the call-sites that swap mock data for API calls or remove the `/app/chat` route.

## Prerequisites

- `apps/web/`, `packages/ui/` empty folders exist
- The template under `src/` and `public/` at the repo root is the source of truth
- `pnpm-lock.yaml` exists

## Procedure

Follow [`__specs/17-template-asset-inventory.md`](../../__specs/17-template-asset-inventory.md) §7 (Migration Order) exactly. Summary:

1. **Move shadcn primitives first** — delegate to [`shadcn-ui-package`](../shadcn-ui-package/). Verify `packages/ui` builds.
2. **Move theme system**: `src/components/theme-{provider,toggle}.tsx`, `src/lib/theme.ts` → `apps/web/src/components/theme/*` and `apps/web/src/lib/theme.ts`. Cookie-driven SSR theme must work on first paint — keep `cookies()` usage in `apps/web/src/app/layout.tsx`.
3. **Move `globals.css`** → `apps/web/src/app/globals.css`. Extract the design-token block (`--background`, `--foreground`, `--surface`, etc.) to `packages/ui/src/styles/tokens.css` and import it from both `apps/web` and `apps/widget` globals.
4. **Move marketing components**: `src/components/{ns,site}/*` → `apps/web/src/components/marketing/**` per spec §17 §4.1.
5. **Move layout shells**:
   - `src/components/layouts/app-shell.tsx` → `apps/web/src/components/dashboard/AppShell.tsx` — **edit**: delete the `{ href: '/app/chat', label: 'Live chat', icon: MessageSquare, group: 'Workspace' }` entry; remove the now-unused `MessageSquare` import; remove the mock `workspaces[]` and `UserMenu` hardcodes (replaced by session data in [`nextauth-google-credentials`](../nextauth-google-credentials/)).
   - `src/components/layouts/admin-shell.tsx` → `apps/web/src/components/admin/AdminShell.tsx` — **edit**: add `Subscriptions` and `Analytics` entries to the `nav` array (routes exist in the template at `src/app/admin/{subscriptions,analytics}/` but the sidebar is missing them).
6. **Move route files**:
   - Marketing: `src/app/{page,features,customers,pricing,contact,not-found}.tsx` → `apps/web/src/app/(marketing)/...`
   - Auth: `src/app/login/page.tsx` → `apps/web/src/app/(auth)/login/page.tsx`; `src/app/signup/page.tsx` → `apps/web/src/app/(auth)/register/page.tsx` (rename `/signup` → `/register`)
   - Dashboard: `src/app/app/*` → `apps/web/src/app/(dashboard)/app/*` — **except** `src/app/app/chat/` which is deleted entirely
   - Admin: `src/app/admin/*` → `apps/web/src/app/(admin)/admin/*`
7. **Move data + utils**: `src/data/ns-*.ts` → `apps/web/src/data/marketing/*`; `src/utils/{domUtils,ns-cn,springer,stackCards}.ts` → `apps/web/src/lib/marketing/*`.
8. **Public assets**: copy ONLY the folders enumerated in spec §17 §5.1. Drop everything in §5.2 — that's `gradient/` (22 MB), every `home-page-N/` except `home-page-34`, plus the unused `blogs/`, `case-study/`, `career/`, `affiliates/`, `about-page-0{1,2,3}/`, `learn-page/`, `use-case-page/`, `process/`, `services/`, and the Next.js scaffold SVGs.
9. **Update path imports** across moved files: `@/components/ui/*` → `@csb/ui`, `@/lib/utils` → `@csb/ui/utils`, `@/hooks/use-mobile` → `@csb/ui/hooks/use-mobile`.
10. **Delete the source tree** `src/` and `public/` from the repo root only after `pnpm --filter @csb/web build` succeeds.

## Critical edits (not just moves)

| File | Edit |
|------|------|
| `apps/web/src/components/dashboard/AppShell.tsx` | Remove `Live chat` nav entry + unused `MessageSquare` import |
| `apps/web/src/components/admin/AdminShell.tsx` | Add `Subscriptions` + `Analytics` nav entries |
| `apps/web/src/app/(auth)/login/page.tsx` | Reuse existing template content; auth wiring in `nextauth-google-credentials` |
| `apps/web/src/app/(auth)/register/page.tsx` | Renamed from `/signup` route |
| `apps/web/src/app/layout.tsx` | Keep cookie-based theme reading |

## Gotchas

- **Per project AGENTS.md**: this is Next.js 16 + React 19 + Tailwind 4 — APIs differ from training-data Next.js. Check `node_modules/next/dist/docs/` before changing route conventions, server actions, or `cookies()` usage.
- **Do not "rewrite" pages** — the template is the spec for visuals. If it looks wrong, you moved it wrong.
- **`next.config.ts` must set `output: 'standalone'`** for the Docker image to work — required by [`docker-multi-stage-apps`](../docker-multi-stage-apps/).
- **Cookie theme**: if the theme flickers on first paint, the root layout isn't awaiting `cookies()` — it's an async server component in Next 16.
- **Live chat removal verification**: `grep -r "Live chat\|/app/chat" apps/` must return zero hits.

## Acceptance

- [ ] `pnpm --filter @csb/web build` succeeds with zero errors
- [ ] Every visual route (marketing, dashboard, admin) renders identically to the original template
- [ ] `grep -rE "Live chat|/app/chat" apps/web/` returns zero results
- [ ] Admin sidebar shows: Dashboard, Users, Subscribers, Subscriptions, Analytics, Settings
- [ ] Dashboard sidebar shows the Workspace / Configure / Account groups from spec §11 (no `Live chat`)
- [ ] `apps/web/public/images/` is < 5 MB
- [ ] Cookie-driven dark/light theme works on first paint on every route group

## Specs referenced

- [`__specs/17-template-asset-inventory.md`](../../__specs/17-template-asset-inventory.md) — file-by-file map, §5 asset keep/drop list, §7 migration order
- [`__specs/11-page-wiremap.md`](../../__specs/11-page-wiremap.md) — sidebar diagrams
- [`__specs/02-monorepo-structure.md`](../../__specs/02-monorepo-structure.md) — target folder layout
- Project [`AGENTS.md`](../../AGENTS.md) — Next.js 16 deprecation note
