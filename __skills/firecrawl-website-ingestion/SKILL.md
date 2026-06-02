---
name: firecrawl-website-ingestion
description: Crawl a customer website via Firecrawl, convert pages to KnowledgeSource records, then chunk+embed them through the Pinecone pipeline. Async with job tracking. Use during Phase 3 after pinecone-kb-pipeline is working. Implements __specs/04-pinecone-firecrawl.md §"Firecrawl".
---

# Firecrawl Website Ingestion

## When to use

Phase 3, after [`pinecone-kb-pipeline`](../pinecone-kb-pipeline/). This skill bridges Firecrawl's crawl API to the KB pipeline — it doesn't reimplement chunking or embedding.

## Prerequisites

- `FIRECRAWL_API_KEY`, `FIRECRAWL_BASE_URL`, `FIRECRAWL_MAX_PAGES` in `apps/api/.env`
- Pinecone pipeline working (file uploads can succeed end-to-end)
- A way to receive async callbacks from Firecrawl OR a polling job (Firecrawl supports both; we use polling for simplicity in v1)

## Procedure

1. **Service** — `apps/api/src/services/kb/firecrawl.service.ts`:
   - `startCrawl({ url, orgId, websiteId, maxPages? })` → POSTs to Firecrawl, stores returned `jobId` on a new `KnowledgeSource` doc with `type: 'website'`, `embeddingStatus: 'processing'`
   - `pollCrawl(jobId)` → GET status from Firecrawl; on `completed` → iterate pages → for each page, call `ingestionService.ingestText({ orgId, sourceId, text, metadata: { url } })` (reuses the chunk+embed pipeline)
   - `cancelCrawl(jobId)` → DELETE on Firecrawl + mark source as `error`

2. **Route** (`apps/api/src/routes/kb.routes.ts`):
   - `POST /knowledge/website` body `{ url, maxPages? }` → calls `startCrawl` → returns `202 Accepted` with `{ jobId, sourceId }`
   - `GET /knowledge/:sourceId` includes `crawlStatus` derived from Firecrawl polling

3. **Background job** — `apps/api/src/jobs/firecrawl-ingest.job.ts` runs every 30 s:
   - Find sources with `type: 'website'` + `embeddingStatus: 'processing'` + `firecrawlJobId` set
   - Poll each; on completion, ingest pages; on failure, mark `embeddingStatus: 'error'`

4. **Page → text** — Firecrawl returns markdown per page. Persist a single `KnowledgeSource` row per *site* (not per page); each page becomes one or more chunks in Pinecone with metadata `{ url, title, pageIndex }`. Spec §04: "Website ingestion: one Mongo source, many Pinecone vectors".

5. **SSRF protection** — `POST /knowledge/website` MUST validate the URL:
   - Resolve DNS → reject if the IP is private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, link-local, loopback) — spec §12 §7.2 acceptance: "SSRF protection on Firecrawl URL input (block private IPs)"
   - Reject non-HTTP(S) schemes
   - Reject URLs over a sane length (2048)

6. **Page cap** — `FIRECRAWL_MAX_PAGES` (default 50) clips runaway crawls. Per-plan caps (see [`paddle-billing`](../paddle-billing/)) override the global default.

7. **Idempotency** — if the same URL is submitted twice for the same org while a job is in flight, return the existing `sourceId` rather than starting a duplicate crawl. After completion, dedup is handled by `contentHash` per page in the embedding pipeline.

## Gotchas

- **Firecrawl quota** — free tier is small. Plan limits (`Free: 100 pages/month`, etc.) come from [`paddle-billing`](../paddle-billing/). Enforce server-side BEFORE calling Firecrawl.
- **Polling vs webhooks** — Firecrawl supports webhooks but webhooks require a public callback URL. In local dev, use polling; in production, prefer webhooks (set up via `ngrok`/`cloudflared` in dev — spec §19 §8).
- **Async error mode** — if Firecrawl returns 5xx, mark the source `error` and surface in the dashboard. Don't crash the API server.
- **Large sites** — a 1000-page site produces ~5000 chunks. Stream the ingestion (process page-by-page, don't accumulate in memory).
- **Pages can be HTML or PDFs or images** — Firecrawl already extracts text, so the ingestion path is simpler than for file uploads.
- **URL canonicalization** — different URL forms (`https://example.com`, `https://example.com/`, `https://www.example.com`) should be considered the same site for the dedup heuristic. Use a `URL`-parsed canonical form.

## Acceptance

- [ ] `POST /knowledge/website` with a valid URL returns 202 + jobId; source created with `embeddingStatus: 'processing'`
- [ ] Polling job advances status to `synced` after Firecrawl completes
- [ ] Pinecone has one chunk per page in the org's namespace, with `url` metadata
- [ ] AI agent's `search_kb` returns crawled content for relevant queries
- [ ] Submitting a private IP / non-HTTP URL returns 400 with `code: 'INVALID_URL'`
- [ ] Submitting the same URL while a job is in flight returns the existing `sourceId`
- [ ] Plan-cap exceeded → 402 with `code: 'PLAN_LIMIT'` BEFORE Firecrawl is called

## Specs referenced

- [`__specs/04-pinecone-firecrawl.md`](../../__specs/04-pinecone-firecrawl.md) §"Firecrawl" — full crawl + ingest design
- [`__specs/07-api-specification.md`](../../__specs/07-api-specification.md) §"Knowledge Base" — `POST /knowledge/website`
- [`__specs/12-security-compliance.md`](../../__specs/12-security-compliance.md) §7.2 — SSRF requirement
- [`__specs/16-production-readiness-audit.md`](../../__specs/16-production-readiness-audit.md) §3.7 — KB audit (covers website too)
