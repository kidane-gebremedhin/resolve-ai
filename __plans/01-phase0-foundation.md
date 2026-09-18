# Phase 0 — Foundation

## Goal

`pnpm dev` boots all four apps (web :3000, widget :3001, embed :3002, api :4000). The template at the repo root is migrated into `apps/web/` with `/app/chat` deleted and visuals unchanged. Google sign-in produces a valid session. The `csb-dev` Coolify environment is live behind TLS. CI is green on the `dev` branch.

## Prerequisites

- Node 20 via `nvm install` (reads `.nvmrc`)
- `pnpm 9` via `corepack enable && corepack prepare pnpm@9 --activate`
- Docker engine + compose v2
- Google OAuth client created in Google Cloud Console with `http://localhost:3000/api/auth/callback/google` as a redirect URI
- A Coolify control-plane VPS available (or willingness to provision one mid-phase)
- GitHub repo created with branches `main`, `staging`, `dev` and the protection rules in [`__specs/18-cicd-pipeline.md`](../__specs/18-cicd-pipeline.md) §1

## Skills to invoke

- [[__skills/pnpm-turbo-monorepo]] — workspace bootstrap (step 1)
- [[__skills/shadcn-ui-package]] — primitives → `packages/ui` (step 2, before route migration)
- [[__skills/nextjs16-template-migration]] — move routes + shells, delete `/app/chat` (steps 3–6)
- [[__skills/nextauth-google-credentials]] — auth wiring (step 7)
- [[__skills/docker-multi-stage-apps]] — 4 Dockerfiles (step 8)
- [[__skills/github-actions-monorepo]] — `ci.yml` + `release-images.yml` + `deploy-production.yml` (step 9)
- [[__skills/coolify-three-env-deploy]] — `csb-dev` project + DNS (step 10)
- [[__skills/mcp-builder]] (downloaded) — reference when authoring `.mcp.json` (step 11)
- [[__skills/webapp-testing]] (downloaded) — Phase verification

## Work breakdown (ordered)

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | Bootstrap pnpm + Turbo workspace | `pnpm-workspace.yaml`, `turbo.json`, root `package.json`, `.nvmrc`, `.gitignore`, `.dockerignore`, `.env.example`, `apps/{web,widget,embed,api}/package.json`, `packages/{ui,shared-types,config}/package.json` | `pnpm-turbo-monorepo` | `pnpm install` succeeds; `pnpm turbo run build --dry-run` lists all 7 workspaces |
| 2 | Extract shadcn primitives → `@csb/ui` | `packages/ui/src/components/*` (40 files), `packages/ui/src/lib/utils.ts`, `packages/ui/src/hooks/use-mobile.tsx`, `packages/ui/src/styles/tokens.css`, `packages/ui/src/index.ts`, `packages/ui/tailwind.config.ts`, `packages/ui/components.json` | `shadcn-ui-package` | `import { Button } from '@csb/ui'` works from both web + widget |
| 3 | Migrate marketing + auth routes | `apps/web/src/app/(marketing)/{page,features,customers,pricing,contact,not-found}.tsx`, `apps/web/src/app/(auth)/{login,register}/page.tsx`, `apps/web/src/components/marketing/**` | `nextjs16-template-migration` | All marketing routes render visually identical to template |
| 4 | Migrate dashboard routes; **DELETE** `/app/chat`; **EDIT** `AppShell` | `apps/web/src/app/(dashboard)/app/{page,inbox,knowledge,widget,leads,websites,ai,usage,billing,analytics,settings}/page.tsx`, `apps/web/src/components/dashboard/AppShell.tsx` | `nextjs16-template-migration` | `grep -rE "Live chat\|/app/chat" apps/web/` returns zero hits |
| 5 | Migrate admin routes; **EDIT** `AdminShell` to add Subscriptions + Analytics | `apps/web/src/app/(admin)/admin/{page,users,subscribers,subscriptions,analytics,settings}/page.tsx`, `apps/web/src/components/admin/AdminShell.tsx` | `nextjs16-template-migration` | Admin sidebar shows all 6 entries |
| 6 | Migrate public assets (only keep list); drop 22 MB gradient + unused folders | `apps/web/public/{fonts,images/{authentication,features,home-page-34,icons,shared,our-team,pricing,avatar,analytics,support-page}}` | `nextjs16-template-migration` | `du -sh apps/web/public/images` < 5 MB |
| 7 | Wire NextAuth (Google + credentials), session providers, dashboard/admin guards | `apps/web/src/lib/auth.ts`, `apps/web/src/app/api/auth/[...nextauth]/route.ts`, `apps/web/src/app/(dashboard)/layout.tsx`, `apps/web/src/app/(admin)/layout.tsx`, `apps/web/src/components/auth/SocialAuth.tsx` (wire `signIn('google')`), `AppShell` (replace mock workspaces + UserMenu with session data) | `nextauth-google-credentials` | Google sign-in lands on `/app` with session; unauth `/app/inbox` → `/login`; non-admin `/admin` → 404 |
| 8 | Author 4 Dockerfiles + `.dockerignore` + `apps/web/app/api/health/route.ts` + `apps/embed/nginx.conf` | `apps/web/Dockerfile`, `apps/widget/Dockerfile`, `apps/embed/Dockerfile`, `apps/api/Dockerfile`, `apps/embed/nginx.conf`, `apps/web/src/app/api/health/route.ts`, `apps/api/src/index.ts` (stub `/health`) | `docker-multi-stage-apps` | All 4 `docker build` commands succeed; each image < 250 MB |
| 9 | Wire GitHub Actions (`ci.yml`, `release-images.yml`, `deploy-production.yml`); add branch protection | `.github/workflows/{ci,release-images,deploy-production}.yml`, repo Settings → Branches | `github-actions-monorepo` | First PR to `dev` runs all 6 CI jobs; merge produces 4 GHCR images |
| 10 | Stand up `csb-dev` Coolify project; DNS for `*.dev.resolve-ai.app`; TLS | `coolify/docker-compose.dev.yml` (committed for reference), Coolify UI, DNS panel | `coolify-three-env-deploy` | `https://dev.resolve-ai.app` loads with TLS; healthchecks pass on all 5 services |
| 11 | Author `.mcp.json` at repo root with chrome-devtools, mongo, paddle, pinecone, github, filesystem, docker, context7 (per spec §21) | `.mcp.json` | `mcp-builder` (reference) | `claude .` loads MCPs without error; `mongo` MCP lists local collections |
| 12 | Bootstrap `docker-compose.yml` + `scripts/mongo-init.js` + add `pnpm dev:infra` script | `docker-compose.yml`, `docker-compose.full.yml`, `scripts/mongo-init.js` | (no skill — direct copy from spec §19 §2+§3) | `pnpm dev:infra` starts mongo + redis + mailhog + minio with healthchecks green |

## Verification

- [ ] `pnpm install && pnpm dev` from a clean clone starts all 4 apps within 60 s
- [ ] Visit `http://localhost:3000` — marketing landing renders identical to template
- [ ] Visit `http://localhost:3000/login` — Google sign-in completes; lands on `/app` with real session data in `AppShell`
- [ ] Visit `http://localhost:3000/app/chat` — returns 404
- [ ] `grep -rE "Live chat|/app/chat" apps/web/` → zero hits
- [ ] `pnpm turbo run lint type-check build` → all green
- [ ] Visit `https://dev.resolve-ai.app` (after Coolify deploy) — same rendering as local
- [ ] Use [`webapp-testing`](../__skills/webapp-testing/) (Playwright) to script: open homepage, click "Sign in", confirm sign-in form appears
- [ ] `chrome-devtools-mcp` reports zero console errors on `/`, `/login`, `/app` (after sign-in)
- [ ] `mongo-mcp` connects to local Mongo (no real schemas yet — Phase 1)
- [ ] [`__specs/16-production-readiness-audit.md`](../__specs/16-production-readiness-audit.md) §2.6 "Deleted/Removed Items" — all three boxes checked

## Out of scope (defer to later phase)

- Any real API routes beyond `/health` (Phase 1)
- Any database models (Phase 1)
- Socket.io wiring (Phase 2)
- KB ingestion + Pinecone (Phase 3)
- Paddle billing (Phase 4)
- `csb-staging` and `csb-production` Coolify projects (staging in Phase 3, prod in Phase 4)
- Production secrets — only dev secrets needed in Phase 0
