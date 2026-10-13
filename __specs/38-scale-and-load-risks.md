# 38 — Scale and Load Risks

What breaks as traffic, files and knowledge bases grow, as of 2026-10-09.
Paths are under `apps/api/src/` unless they start with a top-level folder.
Provenance tags match `37-rag-pipeline-audit.md`: **[measured]** (this audit,
this machine), **[recorded]** (an earlier phase, cited to a spec), **[code]**,
**[derived]**.

**What could be measured.** Everything that needs no provider call: parsing,
chunking and the pseudo-embedding path at the 25MB upload cap, MongoDB query
plans at 100k chunks, and the dependency audit. **What could not:** anything
needing real model or embedding calls (no API keys on this machine), and any
production traffic distribution (the telemetry holds one real turn). The load
tests for those are written out in §6 with the exact commands.

The previous version of this document reported "parse + chunk of a 25MB file in
84ms inside 80MB of heap" and "all hot-path queries index-backed". Both were true
only for the inputs it tried; §1 and §3 show the inputs where they are not.

---

## 1. Very large uploads  [measured]

Method: real `parseFile → chunkText → embed` (`services/kb/parsers.ts:106`,
`utils/chunker.ts:39`, `services/ai/embedding.service.ts`), one 24-25MB file per
process. With no embedding key the service uses its pseudo-embedding branch
(`embedding.service.ts:126-134`), which returns real 1536-dimension vectors in
the same sequential batches of 96 (`:140-141`), so memory and batch counts match
production; only the network time is absent. Files: realistic, low-repetition
prose; XLSX and DOCX sized so the compressed file sits under the 25MB multer cap
(`routes/kb.routes.ts:26-28`).

| File | Size | Text | Chunks | Embed batches | Parse | **Chunk** | Peak RSS (whole path) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.txt`, markdown, heading every paragraph | 24.9MB | 24.9MB | 25,222 | 263 | 0.3s | **40.8s** | 944MB |
| `.csv` | 24.9MB | 24.5MB | 25,833 | 270 | 11.9s | **537.1s** | 917MB |
| `.html` | 24.9MB | 23.6MB | 24,286 | 253 | 6.1s | **486.4s** | 882MB |
| `.pdf` (uncompressed text streams) | 24.3MB | 21.9MB | parse only | | **17.7s** | not run | 538MB (parse) |
| `.xlsx` | 24.6MB | 19.2MB, **0 blank lines** | parse only | | 1.2s | not run, see below | 459MB (parse) |
| `.docx` | 24.5MB | **parse fails** | | | | | |

### Finding 1: chunking is quadratic on common shapes, and blocks the event loop

`chunkText` is synchronous and runs inside the API process (ingestion is inline,
§2), so every second below is a second in which **no HTTP request, socket event
or streamed token is served for any tenant on that instance**.

Scaling measured on generated text of each shape:

| Shape | 1MB | 2MB | 4MB | 8MB |
| --- | --- | --- | --- | --- |
| Plain prose, no headings | 18ms | 93ms | 100ms | 123ms |
| Markdown, heading every 20 paragraphs | 16ms | 107ms | 87ms | 213ms |
| Markdown, heading every paragraph | 142ms | 327ms | **1.2s** | **4.3s** |
| CSV rows (no blank lines) | **1.5s** | **6.1s** | **23.1s** | **83.2s** |

Two causes, both in code that runs once per chunk:

- `text.lastIndexOf("\n\n", end)` and `text.lastIndexOf(". ", end)`
  (`utils/chunker.ts:53-54`) search backwards **from the window end to the start
  of the whole string** when the separator is absent. CSV, HTML-derived text
  and spreadsheet text have no blank lines, so each chunk rescans everything
  before it: O(n²). This is the CSV, HTML and (by its 0 blank lines) XLSX case.
- `headingPathAt` (`utils/markdown-structure.ts:68-75`) walks every heading from
  the start for every chunk: O(chunks × headings). The 24.9MB markdown file has
  100,888 headings.

**Thresholds for a >1s stall:** about **1MB of CSV/HTML/spreadsheet text** or
**4MB of heading-dense markdown**. The 25MB cap allows 537s.

### Finding 2: DOCX ingestion is broken by a dependency override

Every DOCX fails at parse with `DOMParser.parseFromString: the provided mimeType
"undefined" is not valid`. Cause, verified directly:

- `mammoth@1.12.0` depends on `@xmldom/xmldom ^0.8.6` and calls
  `domParser.parseFromString(string)` with no MIME type
  (`node_modules/.pnpm/mammoth@1.12.0/.../lib/xml/xmldom.js:13`).
- The security override `@xmldom/xmldom: >=0.8.15` (root `package.json`
  `pnpm.overrides`, lockfile header) resolves to **0.9.12**, which makes the MIME
  type mandatory. Called directly, 0.9.12 throws on a no-MIME call.
- The lockfile has resolved 0.9.12 since commit `3d40ab5` (2026-08-27); before
  that, `8012b15` resolved 0.8.13.
- No test parses a real DOCX: `__tests__/ingestion-observability.test.ts:75`
  only classifies an error string.

So **every DOCX upload since 2026-08-27 fails** in any build from the lockfile.
Fix pattern, the same as the `brace-expansion` fix in `CHANGELOG_3`: scope the
override, `"@xmldom/xmldom@^0.8": "^0.8.15"`. Severity Critical for any customer
who uploads Word documents. **Disclosure:** the `CHANGELOG_3` pass moved this
unbounded override into `package.json` while scoping only `brace-expansion`; it
did not introduce the bug, and did not catch it.

### Finding 3: memory

- Parse-stage peaks were 459-538MB RSS for a 25MB file; the full path (parse,
  chunk and the full vector array that `ingestSource` holds before upserting,
  `services/kb/ingestion.service.ts:204-221`) peaked at **882-944MB RSS** and
  584-623MB heap.
- That is per concurrent ingest. Uploads are accepted with no concurrency limit
  (`routes/kb.routes.ts:108,177,304` fire-and-forget), so **three or four
  simultaneous 25MB uploads** approach this machine's Node heap limit
  (4,288MB, measured with `v8.getHeapStatistics()`); production containers are
  capped at 512MB (`coolify/docker-compose.production.yml:45-50`). **At a 512MB
  container limit, a single 25MB text, CSV or HTML upload exceeds the limit**
  [derived from the measured 882-944MB peak].
- A DOCX or XLSX expands on decompression. During generation, a 25MB DOCX of
  repetitive text produced more than V8's maximum string length (~512MB) of XML,
  so the 25MB cap bounds the compressed size, not what the parser must hold.

## 2. Inline ingestion, deploys and the reconcile job  [code]

- **Ingestion still runs inline.** Upload and text routes start `ingestSource`
  fire-and-forget in the request process (`routes/kb.routes.ts:108,177,304`);
  re-ingest awaits it (`:278`). There is no queue.
- **A deploy mid-ingest** leaves the source in `processing`. The reconcile job
  re-queues sources stuck past `KB_INGEST_STUCK_PROCESSING_MS` (15 min,
  `config/env.ts:184`; `jobs/embedding-reconcile.job.ts:186-214`). Data is not
  lost; the customer waits up to 15 minutes plus one tick, and the partial
  vectors from the killed run are overwritten (ids are deterministic) except in
  the shrinking-re-ingest case (`37` I4).
- **Within one process, reconcile ticks cannot overlap.** `reconcileOnce` walks
  its batch of up to 20 sources **sequentially** (`embedding-reconcile.job.ts:36,71,141`
  and `:193,214`), so a tick containing one large CSV takes at least the 537s
  chunk time above, far past the 60s interval (`jobs/index.ts:28`).
  `serialLoop` (`jobs/serial-loop.ts`, wired at `jobs/index.ts:47-82`) drops the
  ticks that would overlap and logs them, so the same source is not ingested twice
  **by one process**. The note in `jobs/index.ts:4-8` ("no external queue
  infrastructure required for Phase 3") holds for one process.
- **Across processes it does not hold.** The production compose file runs the
  API at `replicas: 2` (`coolify/docker-compose.production.yml:46`).
  `serialLoop` is in-memory, and the reconcile, firecrawl and index-health
  queries do not claim work atomically (they select by status:
  `embedding-reconcile.job.ts:57,154,186`; `firecrawl-ingest.job.ts:84`), so two
  replicas select the same sources and embed them twice. The same two replicas
  also split Socket.IO rooms, OTP codes and rate limits (`RUNBOOK.md` §10.3, which
  says the API must run as exactly one replica).

## 3. MongoDB index coverage on the hot paths  [measured]

Method: a throwaway `mongod` 8.2.6, all model indexes built with
`syncIndexes()`, two tenants (A: 200 chunks; B: 100,000 chunks; 20,000
knowledge sources across statuses), and `explain("executionStats")` on each
query exactly as the code writes it.

| Query | Phase | Plan | Returned | Keys / docs examined | Time |
| --- | --- | --- | --- | --- | --- |
| Lexical `$text`, tenant A (`services/kb/lexical-search.service.ts:46`) | P4 | TEXT_MATCH over the shared text index | 8 | **200,400 / 200,400** | **8,530ms** |
| Reconcile, errored (`jobs/embedding-reconcile.job.ts:57`) | P8 | IXSCAN | 20 | 20 / 20 | 6ms |
| Reconcile, exhausted (`:154`) | P8 | IXSCAN | 20 | 20 / 20 | 0ms |
| Reconcile, stuck (`:186`) | P8 | IXSCAN | 20 | 21 / 21 | 0ms |
| Firecrawl poll (`jobs/firecrawl-ingest.job.ts:84`) | n/a | IXSCAN | 20 | 136 / 136 | 3ms |
| Drift scan (`jobs/index-health.job.ts:79`) | P11 | IXSCAN + **in-memory SORT** | 5,000 | 13,335 / 13,334 | 142ms |
| Reply history (`services/ai/graph/runner.ts:190`) | n/a | IXSCAN | 0 | 0 / 0 | 2ms |
| Prompt KB titles (`runner.ts:217`) | n/a | IXSCAN | 100 | 100 / 100 | 15ms |

The P9 dashboard queries and the P11 index-health reads are asserted continuously
by the profiler test in `__tests__/rag-metrics.test.ts` (every collection the
dashboard touches, with and without an agent filter; it fails on any `COLLSCAN`).

**The lexical leg scales with the platform, not the tenant.** The text index is
`{ text: "text", headingPath: "text" }` with no tenancy prefix
(`models/KbChunk.ts:62-65`); the comment at `:67-68` assumes the separate
`{organizationId, agentId}` index serves the query, but MongoDB answers `$text`
from the text index and filters tenancy afterwards. At ~100k matching chunks
platform-wide the query takes 8.5s against a 1.5s timeout
(`config/env.ts:129`), so **every tenant silently degrades to dense-only**
(`services/kb/search.service.ts:73-82`). Fix: a compound text index with an
equality prefix, `{ organizationId: 1, agentId: 1, text: "text", headingPath: "text" }`,
which every lexical query already satisfies.

**The drift scan sorts in memory** (`index-health.job.ts:79-87`: filter on
`embeddingStatus`, sort on `updatedAt`, projecting `extractedText`). Fine at
20,000 sources (142ms). With large `extractedText` and hundreds of thousands of
synced sources the sort would exceed MongoDB's 100MB in-memory sort limit and
spill to disk. The job is off by default (`config/env.ts:205`). Fix: an index on
`{ embeddingStatus: 1, updatedAt: -1 }`.

## 4. Concurrent traffic  [code + derived]

**There is no concurrency limit anywhere on the reply path.** No semaphore, queue
or limiter exists in `apps/api/src` (searched for `p-limit`, `p-queue`,
`semaphore`, `concurrency`). Every turn runs to completion in the process that
received it.

**Per-call bound.** Each chat-model call has a 30s timeout and 2 retries
(`config/env.ts:68,70`, applied at `services/ai/llm/chat-model.ts:65-68`), so one
call can hold up to **~90s** plus backoff.

**Per-turn worst case** [derived]:

| Component | Bound | Source |
| --- | --- | --- |
| Agent steps | up to 10 × ~90s | `AI_MAX_TOOL_TURNS` `config/env.ts:73` |
| Query rewrite per search (if on) | 4s timeout | `config/env.ts:84` |
| Lexical leg | 1.5s timeout | `config/env.ts:129` |
| Rerank per search (if on) | 3s timeout | `config/env.ts:146` |
| Finalize | ~90s (two calls, concurrent) | `finalize.node.ts:179-182` |
| **Total** | **~17 minutes** before the turn ends | |

**Expected in-flight turns** (Little's law) = message rate × mean turn time. The
only measured turn time is the single real turn, 11.3s [telemetry], so at 10
customer messages per second roughly 110 turns are in flight. **During a provider
brownout**, where calls hang to their timeout rather than failing fast, a turn
becomes ~180s (one agent step and finalize at ~90s each) and the same 10/s
becomes ~1,800 in-flight turns, each holding its history, its open provider
sockets and its socket room. Nothing sheds load. The real ceiling is then
whichever gives first: the OpenRouter key's rate limit (not documented in this
repository and not measured) or process memory. Test T2 (§6) measures it.

**The socket path awaits the turn.** `message:send` awaits `generateAiReply`
inside the handler (`socket/handlers/message.handler.ts:79`), so one socket's
messages are processed one turn at a time. The REST path does not await
(`routes/widget.routes.ts:888`).

## 5. Other load questions

**Socket fan-out on a large ingest** [code]. Not a risk. The only emit during
ingestion is `knowledge:updated` on status transitions
(`services/kb/ingestion.service.ts:27`), 2-3 per source, to the org room. The
high-volume emit is `message:delta` per streamed token (`runner.ts:305`), and it
goes to one contact room.

**Embedding batch partial failure** [code]. `embed()` is called once for the whole
source (`ingestion.service.ts:204`) and loops batches sequentially
(`embedding.service.ts:140-141`). A failure on batch *k* throws the whole call;
nothing has been upserted yet, so the store stays **consistent** (old vectors and
old mirror intact) but the source goes to `error` and the retry **re-pays for
batches 1..k-1**. For a 270-batch source failing at batch 269, that is 268
batches re-bought, up to `KB_INGEST_MAX_RETRIES` (3) times. The inconsistent case
is not the embed stage but the upsert stage: a `partial_upsert`
(`ingestion.service.ts:308`) leaves some new vectors with `pineconeIds` unchanged,
which a later shrinking re-ingest never cleans (`37` I4).

**Pinecone metadata filtering versus per-org namespaces** [code]. Every query
filters `$and [agentId, organizationId]` inside one shared namespace
(`services/kb/search.service.ts:152-154`); namespaces are noted as future
hardening (`ingestion.service.ts:216-219`). Isolation is correct and tested
(`__tests__/vector-tenancy.test.ts`). The scale concern is latency and recall as
the shared index grows: a filtered query searches the whole namespace with the
filter applied. **Not measured here** (no Pinecone key); test T3 (§6) measures it.
Moving to namespaces means re-upserting every vector, which is the same cost as a
re-embed of the stored vectors' text.

**Should `topK` stay fixed as a KB grows?** `AI_KB_SEARCH_TOP_K` is fixed (8,
`.env.example`), and with reranking on, stage 1 widens to 50
(`config/env.ts:145`, `understood-search.ts:95`). **Undetermined:** the largest
corpus ever measured on this system is the 45-case fixture KB, and no Recall@K
versus corpus-size curve exists. Test T1 (§6) produces it. Until then the
defensible position is the one P5 built: keep the final `topK` fixed (it is a
prompt budget, bounded again by `AI_CONTEXT_TOKEN_BUDGET`) and widen stage 1.

**Dependency exposure** [measured, `pnpm audit --prod`, 2026-10-09]: 57
advisories (5 critical, 21 high, 28 moderate, 3 low). `xlsx` has two high
advisories (prototype pollution, ReDoS) with **no patched version on npm**, and it
parses every uploaded spreadsheet and CSV (`services/kb/parsers.ts:67-68`).

## 6. Risk table

| # | Failure | Trigger threshold | Blast radius | Evidence | Fix | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | **Event loop blocked by chunking** | **[measured]** >1s at ~1MB CSV/HTML/sheet text or ~4MB heading-dense markdown; 537s at 25MB CSV | Every tenant on the instance: no HTTP, sockets or streamed replies | `utils/chunker.ts:53-54`, `utils/markdown-structure.ts:68-75` | Bound `lastIndexOf` to the window (`lastIndexOf(sep, end)` but stop at `i`), binary-search heading spans; move ingestion to a worker | Low (the two fixes); Medium (worker) |
| S2 | **DOCX ingestion fails** | **[measured]** every DOCX, since 2026-08-27 | Every customer uploading Word files | §1 Finding 2; `package.json` `pnpm.overrides` | Scope the override to `@xmldom/xmldom@^0.8`; add a real-DOCX parse test | Low |
| S3 | **Lexical leg times out platform-wide** | **[measured]** 8.5s at 100k matching chunks vs 1.5s timeout | All tenants degrade to dense-only, silently | `models/KbChunk.ts:62-65`; §3 | Compound text index with `{organizationId, agentId}` prefix | Low (index build on a large collection) |
| S4 | **Two API replicas against a one-replica design** | Any production deploy of `coolify/docker-compose.production.yml` | Duplicate ingests and spend; Socket.IO, OTP and rate limits split | `coolify/docker-compose.production.yml:46`; `RUNBOOK.md` §10.3 | `replicas: 1` until a Redis adapter and job locks exist | Low |
| S5 | **One 25MB upload exceeds a 512MB container** | **[measured]** 882-944MB peak RSS; limit `coolify/docker-compose.production.yml:45-50` | OOM kill of the API process, every tenant's in-flight turns lost | §1 Finding 3 | Stream parse and chunk; embed and upsert per batch instead of holding all vectors; lower the cap per type | Medium |
| S6 | No concurrency limit; a brownout piles up turns | [derived] ~1,800 in flight at 10 msg/s with 30s-hanging calls | Memory, provider rate limit, every tenant | §4; `chat-model.ts:65-68` | Per-process turn semaphore, per-turn wall-clock deadline, fail fast on provider 5xx | Low-Medium |
| S7 | Partial embedding failure re-pays completed batches | Provider error on batch k of n | Up to (k-1) batches × 3 attempts of spend | `ingestion.service.ts:204`; `embedding.service.ts:140` | Embed and upsert per batch with a resumable cursor | Medium |
| S8 | Orphan vectors after a partial upsert then shrinking re-ingest | Rare sequence (`37` I4) | Outdated passages retrievable | `ingestion.service.ts:214,256,287` | Record ids before upserting; clean by prefix | Low |
| S9 | Drift-scan sort spills | Hundreds of thousands of synced sources with large text | The (opt-in) nightly job slows | `jobs/index-health.job.ts:79-87` | Index `{embeddingStatus: 1, updatedAt: -1}` | Low |
| S10 | `xlsx` advisories with no fix | **[measured]** 2 high, unpatched | Any spreadsheet or CSV upload | `pnpm audit --prod`; `parsers.ts:67-68` | Replace the parser for CSV at least (CSV needs no SheetJS); sandbox the rest | Medium |
| S11 | Fixed `topK` vs corpus size | Undetermined | Recall may degrade silently | `config/env.ts:59` | Run T1 first | n/a |
| S12 | Metadata filtering vs namespaces | Undetermined | Latency as the shared index grows | `services/kb/search.service.ts:152-154` | Run T3 first | High |

Closed since the previous version: reconcile tick overlap within a process
(`jobs/serial-loop.ts`, `__tests__/serial-loop.test.ts`), and the capped dashboard
chunk scan (`services/kb/index-health.service.ts` `scoreChunks`, exact counts,
`__tests__/index-health.test.ts` counts a 20,501-chunk index).

### Status after the 2026-10-10 fix pass

Detail and evidence per item are in `37-rag-pipeline-audit.md` §8.

| # | Status | Measured after |
| --- | --- | --- |
| S1 | **Fixed** (bounded window search, binary-search lookups; output identical) | 25MB chunk time: markdown 0.16s, CSV 0.08s, HTML 0.03s |
| S2 | **Fixed** (`@xmldom/xmldom@^0.8` override; CSV parsed as text) | DOCX and CSV upload and sync in the dashboard |
| S3 | **Fixed** (tenant-prefixed text index) | 400 keys / 2ms where it was 40,400 / 279ms next to a 100x neighbour |
| S4 | **Fixed** (`replicas: 1`) | n/a |
| S5 | **Reduced, still open.** Embed, upsert and mirror run in 256-chunk batches. Separately, any document over 15MB of text is now refused with a clear error, because it never could be stored (MongoDB's 16MB document cap) | Peak RSS at 14.5MB: 872-923MB → 699-763MB over a 404MB idle harness (ingest share ~470-520MB → ~295-360MB); +70MB at 5MB. Still above 512MB at the top of the range; needs a lower per-type cap or a worker (`45` §5 decision 8) |
| S6 | **Fixed** (`AI_MAX_CONCURRENT_TURNS` queue, `AI_TURN_DEADLINE_MS` abort) | A stalled turn returns at the deadline |
| S7 | Open (cost only): batches are smaller, but a retry still re-embeds completed batches | n/a |
| S8 | **Fixed** (ids recorded before the first upsert) | Test |
| S9 | **Fixed** (`{embeddingStatus, updatedAt}` index; plan is a `SORT_MERGE`, no blocking sort) | Test |
| S10-S12 | Unchanged | n/a |

## 7. Load tests to run (need keys or traffic)

**T1: Recall@K versus corpus size (settles S11).** Grow the fixture KB with filler
chunks and rerun the retrieval-only harness at each size. Retrieval-only spends
embedding tokens only. A filler-seeding script does not exist yet; it needs ~100
lines writing synthetic `KnowledgeSource` + `KbChunk` + vectors.

```bash
for n in 100 1000 10000 50000; do
  pnpm --filter @csb/api exec tsx scripts/seed-filler.ts --chunks "$n"   # to be written
  pnpm eval:rag --retrieval-only --k 3,5,10 | tee "reports/topk-$n.txt"
done
```

**T2: concurrent turn ceiling (settles S6).** N simultaneous widget turns at
N = 1, 5, 10, 25, 50, 100; record `RagTurnMetric.durationMs` p50/p95, the error
rate, process RSS, and the first HTTP 429 from OpenRouter. Spends answering
tokens: at the one real turn's $0.0099, 100 turns per step × 6 steps is about
**$6** [derived].

**T3: filtered-query latency versus shared index size (settles S12).** Upsert
filler vectors under 1, 10 and 100 synthetic orgs into a scratch Pinecone index;
time the tenancy-filtered query (`search.service.ts:152-154`) at 10k, 100k and
1M vectors, against a namespace-per-org layout of the same vectors.

**Already run for this document:** the 25MB ingestion runs and the chunker
scaling curve (§1), the `explain()` matrix (§3) and the dependency audit (§5).
The scripts were throwaway, kept out of the repository (no product code changes
in this pass); they can be committed under `packages/rag-eval/load/` if wanted.
