---
name: pinecone-kb-pipeline
description: Build the Knowledge Base CRUD pipeline — extract text from PDF/DOCX/Excel/CSV/Image/HTML, content-hash dedup, chunk, embed via OpenAI text-embedding-3-small, and sync to Pinecone with one namespace per organization. Use during Phase 3 when wiring the operator-side KB. Implements __specs/04-pinecone-firecrawl.md.
---

# Pinecone Knowledge Base Pipeline

## When to use

Phase 3, the central operator-tool capability. Required before [`firecrawl-website-ingestion`](../firecrawl-website-ingestion/) (websites flow through the same chunking + embedding stage) and before the AI agent can search the KB (spec §05 tool `search_kb`).

## Prerequisites

- `apps/api` Express scaffold complete with `KnowledgeSource` model
- Pinecone account + serverless index created (or pod-based; either works)
- `PINECONE_API_KEY`, `PINECONE_INDEX`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_BASE_URL` in `apps/api/.env`
- Local storage path or MinIO S3 endpoint for raw file persistence

## Procedure

The detailed design (chunking strategy, contentHash, retry, deletion sync) is in [`__specs/04-pinecone-firecrawl.md`](../../__specs/04-pinecone-firecrawl.md). This skill is the executable summary.

1. **Service files** under `apps/api/src/services/kb/` and `services/ai/`:
   - `kb.service.ts` — CRUD orchestrator (create / read / update / delete; calls into sub-services)
   - `ingestion.service.ts` — file → text → chunks → embeddings → Pinecone upsert + Mongo update
   - `chunker.service.ts` — sliding-window chunking with overlap (default 512 tokens, 64-token overlap; spec §04)
   - `ai/embedding.service.ts` — batched embedding calls via OpenAI-compatible API
   - `ai/agent.service.ts` exposes `search_kb` tool that queries Pinecone

2. **File parsers** under `apps/api/src/utils/file-parsers.ts`:
   | Type | Parser |
   |------|--------|
   | `pdf` | `pdf-parse` or `pdfjs-dist` |
   | `docx` | `mammoth` (`extractRawText`) |
   | `xlsx` | `xlsx` (`sheet_to_csv`) |
   | `csv` | `papaparse` |
   | `html` | `cheerio` (strip tags, preserve headings) |
   | `image` | Vision model description via OpenRouter (spec §04) |
   | `text` | passthrough |

   MIME validated via `file-type` magic bytes (NOT file extension — spec §12 §7.3).

3. **Content hash**:
   ```ts
   const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
   const contentHash = createHash('sha256').update(normalized).digest('hex');
   ```
   Stored in `knowledgeSources.contentHash`. Unique index on `{ organizationId, contentHash }` rejects duplicates with HTTP 409.

4. **Pinecone namespace strategy** — one namespace per `organizationId`. Every upsert and query passes `namespace: org._id.toString()`. Spec §04: "Pinecone namespace = orgId". This is the org-isolation boundary.

5. **Embedding flow**:
   ```
   create text → chunk → embed(chunks) in batches of 100 → upsert to Pinecone (with metadata: sourceId, chunkIndex, text) → store pineconeIds[] on KnowledgeSource → set embeddingStatus = 'synced'
   ```
   Update `embeddingStatus` transitions: `pending → processing → synced` or `pending → processing → error` (with `retryCount++`).

6. **Update flow** — if source content changes:
   - Recompute `contentHash`; if unchanged, no-op
   - If changed: delete old Pinecone vectors by ID, re-chunk, re-embed, re-upsert, update `pineconeIds[]`

7. **Delete flow**:
   - Mark `embeddingStatus = 'deleting'`
   - Pinecone `deleteMany({ ids: pineconeIds, namespace: orgId })`
   - Delete Mongo doc + raw file from storage
   - Spec §16 §3.7 acceptance: "MongoDB record + Pinecone vectors + storage file deleted"

8. **Reconciliation job** — `apps/api/src/jobs/embedding-sync.job.ts` runs every N minutes:
   - Find sources with `embeddingStatus = 'error'` AND `retryCount < 5`
   - Retry; on success → `synced`; on failure → `error`, increment `retryCount`
   - Beyond 5 retries, leave in `error` state for human investigation

9. **AI agent tool integration** — `ai/agent.service.ts` exposes `search_kb({ query, topK = 5 })`:
   - Embed query → Pinecone `query({ vector, topK, namespace: orgId, includeMetadata: true })`
   - Return matched chunks with sourceId + score
   - Agent uses these in its system prompt context

10. **Routes** (`apps/api/src/routes/kb.routes.ts`) per spec §07 §"Knowledge Base":
    - `GET /knowledge?type=&status=` — list (org-scoped)
    - `POST /knowledge` — create text source
    - `POST /knowledge/upload` — multipart upload (file-type validates MIME)
    - `POST /knowledge/website` — async crawl (delegates to [`firecrawl-website-ingestion`](../firecrawl-website-ingestion/))
    - `GET /knowledge/:id` — detail with chunks
    - `PUT /knowledge/:id` — update
    - `DELETE /knowledge/:id` — delete (cascades to Pinecone + storage)

## Gotchas

- **Pinecone namespace must be a string** — `org._id.toString()`, not the ObjectId itself.
- **Embedding API batch limit** — OpenAI's `text-embedding-3-small` accepts up to 2048 inputs per call but in practice keep batches at 100 to stay under HTTP timeouts.
- **PDF parsing memory** — large PDFs can exhaust Node's heap. Stream-parse if a file exceeds 10 MB; reject files > 50 MB outright.
- **Vision model cost** — image description is expensive. Allow operators to disable image-KB ingestion per source.
- **`contentHash` normalization** must match exactly between create and update — any difference makes dedup fail. Lock the normalization to the helper in `utils/content-hash.ts` and unit-test it.
- **Delete-then-upsert during update** is NOT atomic — if the upsert fails after delete, the KB is empty for that source. Use a 2-phase pattern: upsert new vectors with temporary IDs → swap pineconeIds → delete old. Spec §04 documents this.
- **Pinecone serverless cold-start** — first query after idle period can take 5 s. Warm with a periodic keep-alive query in `jobs/`.
- **Org RLS at Pinecone layer** — even with namespace isolation, never let a query specify the namespace from request input. Always use the JWT's `organizationId`.

## Acceptance

- [ ] Upload PDF → text extracted → chunked → vectors in Pinecone with correct namespace
- [ ] Duplicate upload (same file, same org) returns 409 with `code: 'KB_DUPLICATE'`
- [ ] Different org uploading the same file succeeds (different namespace)
- [ ] Update source content → old vectors deleted, new ones upserted, `pineconeIds` updated
- [ ] Delete source → Mongo + Pinecone + storage all cleaned (verified via `mongo-mcp` + Pinecone MCP)
- [ ] Cross-org isolation: Org A search returns zero Org B results
- [ ] AI agent's `search_kb` tool returns relevant chunks for a known query
- [ ] Failed embedding → `embeddingStatus = 'error'`, retry job re-attempts on schedule
- [ ] Spec §16 §3.7 audit green

## Specs referenced

- [`__specs/04-pinecone-firecrawl.md`](../../__specs/04-pinecone-firecrawl.md) — full pipeline design, chunking, dedup, deletion
- [`__specs/05-ai-agent-design.md`](../../__specs/05-ai-agent-design.md) — `search_kb` tool
- [`__specs/03-data-model.md`](../../__specs/03-data-model.md) — `KnowledgeSource` schema
- [`__specs/07-api-specification.md`](../../__specs/07-api-specification.md) — KB routes
- [`__specs/16-production-readiness-audit.md`](../../__specs/16-production-readiness-audit.md) §3.7 — KB audit
