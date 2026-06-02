# Skills Gallery

A concise catalog of every skill under [`__skills/`](./__skills/) — what it does, whether it was **custom-written** in this repo or **downloaded** (vendored) from [`anthropics/skills`](https://github.com/anthropics/skills), and where it fits in the build.

This file is the **single source of truth for skill provenance**. ([`__skills/README.md`](./__skills/README.md) covers conventions and links here; license attribution is in [`__skills/NOTICE`](./__skills/NOTICE).)

- **Totals:** 16 skills — **13 custom-written**, **3 downloaded** (Apache-2.0, pinned to `anthropics/skills@690f15c`).
- Each skill is a folder with a `SKILL.md` (YAML frontmatter: `name`, `description`); its `description` is what an LLM matches against for auto-invocation.

---

## ✍️ Custom-written (13)

Authored in-repo. Each encodes a *procedure* and implements a design spec under [`__specs/`](./__specs/).

| Skill | Purpose | Phase | Implements |
|-------|---------|-------|-----------|
| [pnpm-turbo-monorepo](./__skills/pnpm-turbo-monorepo/) | Bootstrap the pnpm + Turborepo workspace — 4 apps (web, widget, embed, api) + 3 shared packages (ui, shared-types, config). | 0 | §02 |
| [shadcn-ui-package](./__skills/shadcn-ui-package/) | Extract the 40 shadcn/ui primitives into shared `packages/ui` with design tokens and the `cn()` helper. | 0 | §17 §4.5 |
| [nextjs16-template-migration](./__skills/nextjs16-template-migration/) | Move the root Next.js 16 / React 19 / Tailwind 4 template into `apps/web/` without rewriting visuals; deletes the `/app/chat` route. | 0 | §17 |
| [nextauth-google-credentials](./__skills/nextauth-google-credentials/) | Wire NextAuth in `apps/web` — Google OAuth + email/password, JWT sessions, protected dashboard/admin route groups. | 0 | §10 (Phase 0) · §12 |
| [docker-multi-stage-apps](./__skills/docker-multi-stage-apps/) | Per-app multi-stage Dockerfiles (web/widget/embed/api) — Node 20 alpine, Next.js standalone output, nginx for the embed loader. | 0 | §18 §3 |
| [github-actions-monorepo](./__skills/github-actions-monorepo/) | GitHub Actions for the monorepo — CI (lint/type-check/test/build/security), GHCR image publishing, manual production deploy. | 0 | §18 |
| [coolify-three-env-deploy](./__skills/coolify-three-env-deploy/) | Provision dev / staging / production Coolify projects — compose per env, Traefik labels, Let's Encrypt TLS, per-env secrets. | 0 & 4 | §20 |
| [express-mongoose-scaffold](./__skills/express-mongoose-scaffold/) | Scaffold the `apps/api` Express + Mongoose backend — middleware stack, MongoDB connection, all 12 models w/ indexes, org-scoped RLS, JWT auth. | 1 | §03 · §07 · §12 |
| [socketio-realtime](./__skills/socketio-realtime/) | Attach Socket.io to Express — JWT (dashboard) + session-token (widget) auth, per-conversation/per-org rooms, Redis adapter for HA. | 2 | §08 |
| [widget-embed-iframe](./__skills/widget-embed-iframe/) | Build the `apps/widget` iframe state machine (pre-chat → chat → contact → resolved) and the `apps/embed` Vite loader (`widget.js` data-* injection). | 2 | §09 |
| [pinecone-kb-pipeline](./__skills/pinecone-kb-pipeline/) | Knowledge-base pipeline — extract text (PDF/DOCX/Excel/CSV/Image/HTML), content-hash dedup, chunk, embed (text-embedding-3-small), sync to Pinecone (one namespace per org). | 3 | §04 |
| [firecrawl-website-ingestion](./__skills/firecrawl-website-ingestion/) | Crawl a customer website via Firecrawl → `KnowledgeSource` records → chunk + embed through the Pinecone pipeline; async with job tracking. | 3 | §04 (Firecrawl) |
| [paddle-billing](./__skills/paddle-billing/) | Integrate Paddle Billing — checkout, signature-verified idempotent webhooks, subscription lifecycle, plan-limit enforcement, customer portal. | 4 | §10 (Phase 4) · §16 §6 |

---

## ⬇️ Downloaded (3)

Vendored from [`anthropics/skills@690f15c`](https://github.com/anthropics/skills/tree/690f15cac7f7b4c055c5ab109c79ed9259934081/skills) under **Apache-2.0** (`LICENSE.txt` inside each folder). General-purpose, not repo-specific.

| Skill | Purpose | Used for |
|-------|---------|----------|
| [mcp-builder](./__skills/mcp-builder/) | Guide for building high-quality MCP (Model Context Protocol) servers exposing well-designed tools, in Python (FastMCP) or Node/TS (MCP SDK). | Phase 0 `.mcp.json` authoring; reference for future MCP work. |
| [webapp-testing](./__skills/webapp-testing/) | Playwright toolkit for driving and testing local web apps — verify frontend behavior, debug UI, capture screenshots and browser logs. | Every phase's Verification step. |
| [skill-creator](./__skills/skill-creator/) | Meta-skill to create, edit, and improve skills, run evals, benchmark performance, and optimize a skill's `description` for trigger accuracy. | Authoring new skills in this directory. |

---

## Maintenance

- **Add a skill:** invoke [`skill-creator`](./__skills/skill-creator/) (or copy an existing written skill's shape), then add a row to the correct table here (this is the source of truth — `__skills/README.md` just links here).
- **Update a vendored skill:** re-clone `anthropics/skills`, diff, bump the commit SHA in [`__skills/README.md`](./__skills/README.md) and [`__skills/NOTICE`](./__skills/NOTICE), and update the "Downloaded" note above.
- **Frontmatter check:**
  ```bash
  for f in __skills/*/SKILL.md; do
    head -10 "$f" | grep -qE '^name:' && head -10 "$f" | grep -qE '^description:' \
      || echo "MISSING required frontmatter: $f"
  done
  ```
