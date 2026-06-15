# Phase 10 — Website KB Full-Crawl/Favicon + Visitor Phone Country-Code

> Specs: [`__specs/27-website-kb-crawl-favicon.md`](../__specs/27-website-kb-crawl-favicon.md) (#11), [`__specs/28-phone-country-code.md`](../__specs/28-phone-country-code.md) (#8). Two small, independent refinements bundled into one phase.

## Goal

(#11) When a KB source is a website, crawl **all** links the existing multi-page crawl discovers (no domain restriction; capped only by `FIRECRAWL_MAX_PAGES`), and — best-effort, non-blocking — extract the site favicon and set it as the agent's **default** avatar (never overriding an operator-chosen one). (#8) Detect the visitor's country from their IP (offline geo-IP) and default the country code in the widget's phone inputs using a proper phone-input dependency, fully overridable.

## Prerequisites

- Firecrawl ingestion + polling job + `knowledge:updated` socket (exist).
- Agent/WidgetSettings avatar resolution (exists).
- Widget `/widget/init` + contact capture flow (exists).

## Skills to invoke

- [[__skills/firecrawl-website-ingestion]] — crawl options + ingestion changes.
- [[__skills/express-mongoose-scaffold]] — favicon service, geo lookup, model fields.
- [[__skills/widget-embed-iframe]] — phone country-code dropdown in widget screens.
- [[__skills/webapp-testing]] — verification.

## Work breakdown (ordered)

### #11 — Website full-crawl + favicon

| # | Task | Files | Skill | Acceptance |
|---|------|-------|-------|------------|
| 1 | Confirm the crawl ingests **all** discovered links (no host filtering); only `FIRECRAWL_MAX_PAGES` bounds it. Remove any host-restriction assumptions | `apps/api/src/services/kb/firecrawl.service.ts`, `apps/api/src/services/kb/ingestion.service.ts` | firecrawl-website-ingestion | All discovered pages embedded up to the cap (`mongo-mcp`) |
| 2 | `faviconUrl` on `KnowledgeSource`; `favicon.service.ts` resolves icon (crawl metadata → `<link rel=icon>` → `/favicon.ico`; optional env fallback provider) | `apps/api/src/models/KnowledgeSource.ts`, `apps/api/src/services/kb/favicon.service.ts` (new) | express-mongoose-scaffold | `faviconUrl` populated when resolvable; non-fatal otherwise |
| 3 | On `synced` (best-effort, non-blocking), if agent has no avatar set `Agent.avatarUrl = faviconUrl` | `apps/api/src/jobs/firecrawl-ingest.job.ts` | express-mongoose-scaffold | Default avatar set only when none exists; never overrides |
| 4 | Show favicon on KB list/detail rows | `apps/web/src/components/knowledge/*` | nextjs16-template-migration | Favicon visible; status badge still live |

### #8 — Phone country-code from IP

| # | Task | Files | Skill | Acceptance |
|---|------|-------|-------|------------|
| 5 | Add `geoip-lite`; resolve `req.ip` → ISO country; add `countryCode` to `/widget/init` response | `apps/api/package.json`, `apps/api/src/routes/widget.routes.ts` | express-mongoose-scaffold | Init returns `countryCode` for geo-resolvable IPs; offline (no external call) |
| 6 | Add `react-phone-number-input` (pulls `libphonenumber-js`); `InitResponse.countryCode` type | `apps/widget/package.json`, `apps/widget/src/lib/api-client.ts` | widget-embed-iframe | Dep installed; types compile |
| 7 | Phone-input component in both screens with `defaultCountry` from `countryCode`, overridable; E.164 output; phone stays optional | `apps/widget/src/components/PreChatScreen.tsx`, `ContactPromptScreen.tsx`, `WidgetRoot.tsx` | widget-embed-iframe | Default matches geo; override works; submit stores E.164 value |

### Wrap-up

| # | Task | Files | Acceptance |
|---|------|-------|------------|
| 8 | Rebuild widget; update specs 27/28 + this plan with deltas; append `CHANGELOG_*.md` | docs, build | Docs match shipped behavior |

## Decisions baked in (from specs)
- Crawl ingests **all** discovered links, capped only by `FIRECRAWL_MAX_PAGES` (no domain restriction); favicon best-effort, non-blocking; avatar set only when none exists.
- Offline `geoip-lite`; country piggybacked on `/widget/init`; widget uses a phone-input **dependency** (`react-phone-number-input` / `libphonenumber-js`) for the country dropdown + E.164 output; country is an overridable default and never blocks submission.

## Open questions (default if unanswered)
- **27/O1** re-crawl refreshes favicon but still only auto-sets avatar if none set.
- **28/O1** widget-only (dashboard phone fields are a follow-up).

## Verification
- [ ] Website source crawls all discovered links up to the cap, reaches `synced`, live badge updates.
- [ ] Favicon populated; default avatar applied only when agent had none; operator avatar preserved.
- [ ] Widget phone input defaults to geo country (offline), overridable; E.164 value stored; phone optional.
- [ ] `pnpm build` + `type-check` + `test` green.

## Out of scope (defer)
- Scheduled re-crawls; favicon accept/reject UI; dashboard phone country defaults; timezone detection.
