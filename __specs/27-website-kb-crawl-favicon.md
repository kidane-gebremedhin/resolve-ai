# 27 — Website KB Full-Crawl & Favicon-as-Avatar

## Overview

Backlog item #11: "when a knowledge base is a website, scrape all links, update sync status on complete, and grab the website icon from the header and set it as the default avatar URL of the agent's widget." Plan: [`__plans/11-kb-crawl-and-phone.md`](../__plans/11-kb-crawl-and-phone.md). Builds on Firecrawl ingestion ([`04-pinecone-firecrawl.md`](./04-pinecone-firecrawl.md)).

> **Scope note (updated):** same-base-URL restriction is **dropped** per the latest direction — crawl **all** links Firecrawl discovers (subject only to the `FIRECRAWL_MAX_PAGES` cap). No host filtering.

## Current state

| Piece | Status | Evidence |
|---|---|---|
| Website crawl | ✅ **multi-page already** | `kb/firecrawl.service.ts:startCrawl(url)` posts `{url, limit: FIRECRAWL_MAX_PAGES (50)}` |
| Crawl polling → ingest | ✅ | `jobs/firecrawl-ingest.job.ts` polls every 30s → `ingestCrawlResults` → `synced` |
| Sync status | ✅ | `KnowledgeSource.embeddingStatus` (`pending→processing→synced/error`); `lastSyncedAt`, `chunkCount`; live via `emitKnowledgeUpdate` → `knowledge:updated` socket |
| Add-website UI | ✅ | `add-knowledge-dialog.tsx:submitWebsite` → `POST /knowledge/website`; list shows status badge |
| Agent / widget avatar | ✅ | `Agent.avatarUrl`, `WidgetSettings.avatarUrl` (settings wins); set in Widget Studio |
| Favicon extraction | ❌ | not implemented anywhere |

**Insight:** the "scrape all links" + "update sync status on complete" parts are **already working** (multi-page crawl + status lifecycle). The genuinely new work is just **favicon extraction → default agent avatar**.

## Design

### 1. Crawl all links (no domain restriction)
- Keep the existing Firecrawl multi-page crawl as-is; **do not** add same-domain/host filtering — ingest **every** page Firecrawl returns, up to the `FIRECRAWL_MAX_PAGES` cap.
- Decision: the cap is the only bound (cost/runtime safety). If the crawl follows outbound links, those pages are ingested too. Raising/removing the cap is a separate `FIRECRAWL_MAX_PAGES` config call.

### 2. Sync status on complete
- Already handled by `firecrawl-ingest.job.ts` → `synced` + `emitKnowledgeUpdate`. Verify the terminal transition also fires after favicon extraction (do favicon work **before** flipping to `synced`, or as a non-blocking step that doesn't regress status). Decision: favicon extraction is **best-effort and non-blocking** — never hold or fail `synced` on it.

### 3. Favicon → default avatar
- On crawl start (or completion), resolve the site icon for the source host:
  - Try, in order: crawl metadata (Firecrawl page `metadata.favicon`/`ogImage`), then fetch the homepage and parse `<link rel="icon|shortcut icon|apple-touch-icon">`, then fall back to `https://<host>/favicon.ico`.
  - Optionally use a normalizer service (e.g., Google s2 favicons) as a last resort. Decision: attempt direct extraction first; allow a configurable fallback provider via env, default off.
- Store on `KnowledgeSource.faviconUrl` (new optional field).
- **Set as default agent avatar**: when the crawl completes and the agent has **no** avatar yet (`Agent.avatarUrl` empty **and** `WidgetSettings.avatarUrl` empty), set `Agent.avatarUrl = faviconUrl`. Decision: **default, not override** — never clobber an avatar the operator already chose. Surface it as the agent's avatar (widget already resolves `WidgetSettings.avatarUrl ?? Agent.avatarUrl`).
- UI: show the favicon on the KB list/detail row; if it became the agent avatar, reflect in Widget Studio (which reads `avatarUrl`).

### Per-page citation URLs (Changelog 2)
Each chunk is tagged with the exact page it came from so widget citations link to
the specific page (e.g. `/pricing`), not the site root. Firecrawl returns a page's
URL under `metadata.sourceURL` (not a top-level `url`), so `getCrawlStatus`
normalises each page to `{ url: metadata.sourceURL ?? metadata.url ?? metadata.ogUrl, markdown }`
before `ingestCrawlResults` writes `url` into each chunk's Pinecone metadata; the
search path prefers that per-chunk `url` over the source-level base URL.
**Existing KBs must be re-crawled** to gain per-page URLs.

### Decisions summary
- Crawl ingests **all** discovered links, capped only by `FIRECRAWL_MAX_PAGES`; **no** same-host enforcement.
- Favicon extraction is best-effort, non-blocking, never regresses sync status.
- Favicon sets the avatar **only when none is set** (default, idempotent); operator choice always wins.
- Crawling sets the favicon/avatar **only** — it must **never** touch `Agent.name`. The widget refers solely to the operator-configured Agent Name (see [`09-widget-state-machine.md`](./09-widget-state-machine.md)); deriving the name from the website `<title>` would surface the website/org name in the widget, which is explicitly disallowed.

### Open questions
- O1: Re-crawl behavior on re-sync — refresh favicon? → Default: re-extract favicon but still only auto-set avatar if none set.

## Files
- [`apps/api/src/services/kb/ingestion.service.ts`](../apps/api/src/services/kb/ingestion.service.ts) — trigger favicon step (no host filtering).
- `apps/api/src/services/kb/favicon.service.ts` (new) — resolve site icon.
- [`apps/api/src/models/KnowledgeSource.ts`](../apps/api/src/models/KnowledgeSource.ts) — `faviconUrl`.
- [`apps/api/src/jobs/firecrawl-ingest.job.ts`](../apps/api/src/jobs/firecrawl-ingest.job.ts) — on `synced`, best-effort default-avatar set.
- [`apps/api/src/models/Agent.ts`](../apps/api/src/models/Agent.ts) — (avatar field exists; no change beyond default-set logic).
- KB list/detail UI — show favicon.

## Out of scope
- Scheduled/automatic periodic re-crawls.
- Operator UI to accept/reject the suggested favicon (auto-default only).
- Image processing/normalization of the favicon (resize, format).
- Crawl depth/path include-exclude UI controls.

## Acceptance
- [ ] Adding a website source crawls all discovered links up to `FIRECRAWL_MAX_PAGES` (no host filtering); pages embedded (`mongo-mcp`: pineconeIds present).
- [ ] Status reaches `synced` with `lastSyncedAt`/`chunkCount` set; live badge updates (`knowledge:updated`).
- [ ] `KnowledgeSource.faviconUrl` populated when resolvable; agent with no avatar gets `Agent.avatarUrl = faviconUrl`; an operator-set avatar is never overwritten.
- [ ] `pnpm build` + `type-check` + `test` green.
