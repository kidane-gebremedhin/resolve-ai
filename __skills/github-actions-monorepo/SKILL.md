---
name: github-actions-monorepo
description: Wire GitHub Actions for the pnpm + Turborepo monorepo — CI (lint/type-check/test/build/docker-build/security), GHCR image publishing on dev/staging/main, and manual production deploy. Use during Phase 0 once Dockerfiles exist. Implements __specs/18-cicd-pipeline.md.
---

# GitHub Actions for a pnpm + Turborepo Monorepo

## When to use

Phase 0, after [`docker-multi-stage-apps`](../docker-multi-stage-apps/) so the `docker-build` matrix job has working Dockerfiles to smoke-test. The Coolify deploy hook in `release-images.yml` requires [`coolify-three-env-deploy`](../coolify-three-env-deploy/) to be set up before merging to `dev`.

## Prerequisites

- 4 Dockerfiles working locally (web/widget/embed/api)
- `.nvmrc` pins Node 20
- GitHub repository secrets configured: `TURBO_TOKEN`, `COOLIFY_WEBHOOK_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_PROD_WEBHOOK_URL`, `COOLIFY_PROD_API_TOKEN` (per spec §13 §"CI/CD Variables")
- Repository variables: `TURBO_TEAM`, `DEV_*_URL`, `STAGING_*_URL`, `PROD_*_URL`
- GitHub Environments created: `dev`, `staging`, `production` (with reviewer + 5-min wait on `production`)

## Procedure

The full YAML bodies live in [`__specs/18-cicd-pipeline.md`](../../__specs/18-cicd-pipeline.md) §2 — copy verbatim. Three workflows:

1. **`.github/workflows/ci.yml`** (spec §2.1) — runs on every PR + push to `main`/`staging`/`dev`. Jobs: `setup` (paths-filter) → `lint` + `type-check` + `test` (with Mongo + Redis services) → `build` → `docker-build` (matrix) + `security` (`pnpm audit`, CodeQL, gitleaks).

2. **`.github/workflows/release-images.yml`** (spec §2.2) — runs on push to `main`/`staging`/`dev`. Matrix of 4 apps. Logs into GHCR with `GITHUB_TOKEN`, builds + pushes with `docker/build-push-action@v6` (provenance + SBOM enabled), signs with `cosign`, then POSTs to Coolify webhook with `{ env: <branch>, sha, branch }`.

3. **`.github/workflows/deploy-production.yml`** (spec §2.3) — manual `workflow_dispatch` with `sha` input. Gated by GitHub Environment `production` (requires reviewer). Verifies images exist via `docker manifest inspect`, POSTs to `COOLIFY_PROD_WEBHOOK_URL`, then polls `/health` endpoints for up to 5 minutes.

**No `deploy-dev.yml` / `deploy-staging.yml`** — those environments deploy automatically via `release-images.yml`'s Coolify webhook. Only production needs a gated workflow (spec §18 §2.4).

## Branch protection

In repository Settings → Branches, protect `main`, `staging`, `dev`:
- Required checks: `ci / lint`, `ci / type-check`, `ci / test`, `ci / build`, `ci / docker-build`
- ≥1 approving review
- Linear history (squash merges only)
- Disallow force pushes

## Gotchas

- **`TURBO_TOKEN` for fork PRs** — must be read-only or the Turbo cache leaks across forks. Use a separate read-only token for fork PRs via `pull_request_target` (with care).
- **`pnpm audit --audit-level=high`** can be flaky on transitive dev deps. Spec §18 §8 says it's initially non-blocking (`continue-on-error: true`); flip to blocking once the baseline is clean.
- **CodeQL slow path** — runs on every PR by default. If turnaround time is unacceptable, scope to `push` on `main` + nightly cron.
- **Cosign keyless** needs `id-token: write` permission on the job — it's set in spec §2.2 but easy to miss when copying.
- **paths-filter output** is currently *unused* by downstream jobs in the spec — all jobs always run. If you wire it up, ensure required checks still all run on the trigger branches or branch protection breaks.
- **MongoDB service `--health-cmd`** must use `mongosh` not the legacy `mongo` shell — that's why the image is `mongo:7`.
- **GHCR retention** — without a policy, image storage grows unbounded. Add a separate `.github/workflows/ghcr-prune.yml` (monthly) that keeps only the last 30 SHA tags + `main`/`staging`/`dev` mutable tags. Out of scope for Phase 0, but tracked in spec §18 §7.

## Acceptance

- [ ] PR opened against `main`/`staging`/`dev` triggers `ci.yml` and runs all 6 jobs
- [ ] First green run on `dev` produces 4 GHCR images (`csb-{web,widget,embed,api}:dev` + `:<sha>`)
- [ ] Coolify webhook is called (verify via Coolify activity log)
- [ ] `deploy-production.yml` cannot run without manual approval (GitHub Environment protection)
- [ ] CodeQL + gitleaks scans appear in repo Security tab
- [ ] Each green CI run finishes in under 8 minutes on a warm cache

## Specs referenced

- [`__specs/18-cicd-pipeline.md`](../../__specs/18-cicd-pipeline.md) — full workflows, branching model, secrets, acceptance
- [`__specs/13-env-variables.md`](../../__specs/13-env-variables.md) §"CI/CD Variables" — exhaustive secret + variable list
- [`__specs/20-coolify-deployment.md`](../../__specs/20-coolify-deployment.md) §6 — webhook payload shape
