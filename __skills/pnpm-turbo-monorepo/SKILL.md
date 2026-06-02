---
name: pnpm-turbo-monorepo
description: Bootstrap a pnpm + Turborepo workspace with four apps (web, widget, embed, api) and three shared packages (ui, shared-types, config). Use when starting Phase 0 of the implementation, before any template migration. Implements __specs/02-monorepo-structure.md.
---

# pnpm + Turborepo Monorepo Bootstrap

## When to use

Phase 0, **first step**. Run this once on an empty/clean repo root. After this, all other Phase 0 skills (template migration, shadcn extraction, NextAuth, Docker, CI) operate inside the workspace this creates.

## Prerequisites

- Node 20.x pinned in `.nvmrc`
- pnpm 9.x via `corepack enable && corepack prepare pnpm@9 --activate`
- The existing template at the repo root is **untouched** by this skill — that's [nextjs16-template-migration](../nextjs16-template-migration/).

## Procedure

1. **Pin Node**: write `.nvmrc` with `20`.

2. **Workspace declaration**: write `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
   ```

3. **Root `package.json`**: see [`__specs/02-monorepo-structure.md`](../../__specs/02-monorepo-structure.md) §"Root `package.json`" — copy verbatim, then merge the scripts listed in [`__specs/19-local-development.md`](../../__specs/19-local-development.md) §4 (`dev`, `dev:infra`, `dev:full`, `db:*`, `verify:*`, `format`).

4. **`turbo.json`**: copy from [`__specs/02-monorepo-structure.md`](../../__specs/02-monorepo-structure.md) §"`turbo.json`". Add `test` and `type-check` tasks; mark `outputs: [".next/**", "dist/**"]`.

5. **Empty app folders** (don't scaffold yet — that's later skills):
   ```
   apps/{web,widget,embed,api}/package.json   # @csb/<app>, no deps yet
   packages/{ui,shared-types,config}/package.json
   ```
   Use scope `@csb/*` per spec §02 §"Package Naming Convention".

6. **`.gitignore` + `.dockerignore`**: minimum entries — `node_modules`, `.next/`, `dist/`, `.turbo/`, `coverage/`, `*.log`, `.env*` (except `.env.example`), `certs/`.

7. **`.env.example`**: skeleton from [`__specs/13-env-variables.md`](../../__specs/13-env-variables.md) §"`.env.example` Template". Real secrets are never committed.

8. **Install**: `pnpm install`. Should produce a lockfile and link the empty workspaces.

## Gotchas

- **Do not run `pnpm create next-app apps/web`** — it will overwrite the template you're about to migrate. Create `apps/web` as a manual scaffold and copy template files via the [`nextjs16-template-migration`](../nextjs16-template-migration/) skill.
- **Don't add `"workspaces"` to root `package.json`** — pnpm uses `pnpm-workspace.yaml`, not npm workspaces. Mixing the two confuses tooling.
- **Turbo `globalDependencies: [".env"]`** is intentional — when `.env` changes, all tasks bust cache.

## Acceptance

- [ ] `pnpm install` succeeds, lockfile generated
- [ ] `pnpm turbo run build --dry-run` prints a plan covering all 4 apps + 3 packages
- [ ] Package names match `@csb/web`, `@csb/widget`, `@csb/embed`, `@csb/api`, `@csb/ui`, `@csb/shared-types`, `@csb/config`
- [ ] Root scripts run without error: `pnpm lint`, `pnpm type-check`, `pnpm clean` (no-ops at this stage, but the wiring must resolve)

## Specs referenced

- [`__specs/02-monorepo-structure.md`](../../__specs/02-monorepo-structure.md) — full directory tree, package names, root `package.json` + `turbo.json`
- [`__specs/13-env-variables.md`](../../__specs/13-env-variables.md) §"`.env.example` Template"
- [`__specs/19-local-development.md`](../../__specs/19-local-development.md) §4 — script catalog
