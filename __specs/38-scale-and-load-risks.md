# 38 — Scale and Load Risks

What breaks as traffic, files and knowledge bases grow. Every row carries
`file:line` evidence. Numbers marked **measured** were produced by a test run for
this document; everything else is derived from code and says so.

**Measurement caveat.** Production traffic does not exist yet. The telemetry
sample is 4 turns; the usage sample is 1,516 rows. Where a threshold needs real
concurrency to find, this document writes the load test rather than guessing at
the number.

---

## 1. Measured: the in-memory ingestion path

Ran parse + chunk over synthetic documents. No network, no provider spend.

```
node heap limit: 4288MB
  1MB | parse     1ms | chunk      8ms | chunks   1047 | embed batches  11
  5MB | parse     5ms | chunk      8ms | chunks   5233 | embed batches  55
 10MB | parse     9ms | chunk     14ms | chunks  10465 | embed batches 110
 25MB | parse    20ms | chunk     64ms | chunks  26162 | embed batches 273
 50MB | parse    43ms | chunk    110ms | chunks  52324 | embed batches 546
```

**The parser is not the ceiling.** Heap stayed at 60-80MB throughout, well inside
the 4.3GB limit, and 50MB parsed in 43ms. The multer cap is 25MB
(`kb.routes.ts:28`), so the largest real upload produces **26,162 chunks and 273
sequential embedding batches**.

**The ceiling is the embedding loop.** `MAX_BATCH = 96`
(`embedding.service.ts:36`), batches run **sequentially**
(`embedding.service.ts:~138`), each with a 20s timeout and up to 3 attempts.
273 batches at even 500ms each is **~2.3 minutes of in-process work for one
upload**, and at the 20s timeout ceiling the worst case is 91 minutes.

Derived embedding cost for that upload: 26,162 chunks x ~300 tokens is ~7.8M
tokens; at the **measured** $0.0000201 per 1k tokens (from 1,453 `UsageRecord`
rows) that is **~$0.16 per 25MB file**.

## 2. Measured: Mongo index coverage

Every hot-path query added by P4, P8, P9 and P11 was run through
`explain("queryPlanner")`. **All 12 use an index; none collection-scans.**

| Query | Plan |
| --- | --- |
| `kbchunks` by org+agent (P4 lexical filter) | IXSCAN |
| `kbchunks` `$text` search (P4 lexical leg) | TEXT_MATCH |
| `kbchunks` by `sourceId` / by `chunkId` | IXSCAN |
| `ingestionevents` by source / by org (P8) | IXSCAN |
| `ragturnmetrics` org+agent+window (P9/P10) | IXSCAN |
| `ragturnmetrics` by `retrieval.chunks.chunkId` (P11) | IXSCAN |
| `knowledgesources` by org+status (P11) | IXSCAN |
| `knowledgegaps` open by org (P11) | IXSCAN |
| `messagefeedbacks` by `messageId` | IXSCAN |
| `usagerecords` org+period | IXSCAN |

`rag-metrics.test.ts` additionally asserts this continuously by profiling the
real endpoints and failing on a `COLLSCAN`.

## 3. Risk table

Status column added after the remediation pass: **FIXED** entries are closed and
covered by a test, the rest stand as written.

| # | Failure | Trigger threshold | Blast radius | Evidence | Fix | Effort | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | **Reconcile ticks overlap.** `reconcileTick` is fire-and-forget on a 60s interval with no in-flight guard; a tick processing `BATCH = 20` sources can still be running when the next fires | One tick exceeding 60s. With 273 embed batches per large source (§1), **one** large source can do it | Duplicate `ingestSource` on the same source; concurrent Pinecone upserts of the same ids; embedding spend doubled | `jobs/index.ts:40-46`, `embedding-reconcile.job.ts:36` | An `isRunning` latch per job, or `setTimeout` re-armed after completion | Low | **FIXED.** `jobs/serial-loop.ts` drops a tick whose predecessor is still in flight, and logs the skip and any overrun. `serial-loop.test.ts` |
| S2 | Same for the other three loops | Firecrawl 30s, RAG alerts 15m, index health 30m | Index health re-embeds drifted sources twice | `jobs/index.ts:49-79` | Same latch | Low | **FIXED.** All four loops go through `serialLoop` |
| S3 | **Ingestion runs inline in the API process**, fire-and-forget from the route | Any upload | A deploy mid-ingest loses the run; CPU and heap shared with request serving | `kb.routes.ts:107`, `ingestion.service.ts:74` | Recovered by the stuck-`processing` sweep (`embedding-reconcile.job.ts:185`), so data is safe; the *contention* is not addressed | Medium (needs a queue) | Open |
| S4 | **Partial embedding failure re-pays for completed work.** No per-batch checkpoint | A provider error on batch k of 273 | Whole source marked `error`; retry re-embeds batches 1..k-1. Up to ~$0.16 wasted per large file per attempt, x3 attempts | `ingestion.service.ts` embed block; `MAX_ATTEMPTS = 3` | Persist progress per batch, resume from k | Medium | Open |
| S5 | **Concurrency ceiling per turn is time, not connections.** Worst case = `AI_LLM_TIMEOUT_MS` (30s) x `AI_MAX_TOOL_TURNS` (10) = **300s**, plus rewrite and rerank calls when enabled | A model looping on a failing tool | One turn can hold an async slot for 5 minutes; Node is not thread-bound but sockets, Mongo connections and memory are held | `config/env.ts:68,73` | Add a wall-clock budget per turn independent of the step ceiling | Low | Open |
| S6 | **Socket fan-out on a large ingest.** `emitKnowledgeUpdate` fires to the whole `org:<id>` room on every status change | An org with many dashboard sessions and a bulk ingest | N sources x M connected operators messages; noisy rather than dangerous | `ingestion.service.ts:17-29,96` | Debounce or emit a single batch-complete event | Low | Open |
| S7 | **Fixed `topK` regardless of KB size.** 8 passages sample a 50-document and a 50,000-document corpus identically | Unknown; needs the test in §4 | Recall silently degrades as the corpus grows; no alarm fires | `config/env.ts` `AI_KB_SEARCH_TOP_K` | Scale `topK` with corpus size, or rely on reranking over a wider stage-1 | Medium | Open |
| S8 | **Metadata filtering, not namespaces, at scale.** Every query filters `organizationId`+`agentId` inside one shared namespace | Large multi-tenant index; Pinecone filter selectivity degrades as the index grows | Latency, not leakage. Isolation is asserted by `vector-tenancy.test.ts` | `__specs/04` "Vector-store tenancy" | Per-org namespaces; requires re-embedding every existing vector | High | Open |
| S9 | **Dashboard scans the whole chunk index.** `scoreChunks` lists every `KbChunk` for the org (cap 20,000) on each RAG Quality load | An org with >20,000 chunks silently gets a truncated dead-weight count | Wrong "never retrieved" number, no error | `index-health.service.ts` | Paginate, or compute dead weight as a set difference in an aggregation | Medium | **PARTIALLY FIXED.** The cap remains (the scan must list every chunk to find dead weight), but it is no longer silent: the scan probes one row past `CHUNK_SCAN_LIMIT`, reports `totals.truncated`, and the dashboard, the `kb_weak_chunks` notification and the logs all say the counts cover part of the index. A full-index aggregation is still the real fix. `index-health.test.ts` |
| S10 | **`xlsx` prototype pollution, no fixed version** | A crafted spreadsheet upload | Reachable from `parseSpreadsheet` | `parsers.ts:67`; `pnpm audit` | Replace the parser, sandbox it, or drop Excel support | Medium | Open |
| S11 | Embedding batch timeout is per request, not per source | A 273-batch source with a slow provider | Up to 91 minutes of in-process work | `embedding.service.ts:31` | Per-source deadline | Low | Open |

## 4. Load tests still to run

These need a number that cannot be derived from code. Each is written so it can
be run against the fixture KB.

**T1 — the `topK` vs corpus-size curve (settles S7).** The fixture set is 45
cases over a small KB. Ingest synthetic filler documents to grow the corpus in
steps (100, 1k, 10k, 50k chunks), re-running the harness at each step:

```bash
for n in 100 1000 10000 50000; do
  pnpm --filter @csb/api exec tsx scripts/seed-filler.ts --chunks "$n"
  pnpm eval:rag --retrieval-only | tee "reports/topk-$n.txt"
done
```

Report Recall@5 and MRR against corpus size. Retrieval-only, so it spends
embedding tokens but no judge or answering tokens. **Not run here**: it needs a
seeding script that does not exist and would spend real embedding budget.

**T2 — concurrent turn ceiling (settles S5).** Drive N simultaneous widget turns
and record `durationMs` percentiles and error rate at N = 1, 5, 10, 25, 50.
**Not run here**: every turn spends answering-model tokens, and the OpenRouter
balance on this account is exhausted (observed: `402 ... exceed your available
credits` during this audit).

**T3 — reconcile overlap (settles S1).** Set `KB_INGEST_STUCK_PROCESSING_MS` low,
queue 40 sources (2x `BATCH`), and count `ingestSource` invocations per source id
in the logs. A count above 1 for any source confirms the overlap. **Safe to run
offline** with the embedding provider stubbed; not run here because it needs a
seeding fixture.

## 5. What is already safe

- **Index coverage**: measured, all 12 hot paths (§2), continuously asserted.
- **Parser memory**: measured, 50MB parses in 43ms inside 80MB of heap (§1).
- **Deploy mid-ingest**: recovered by the stuck-`processing` sweep, not lost.
- **Tenancy under load**: the filter is AND-ed and an unscoped query is refused,
  not widened (`search.service.ts:57`).
- **Telemetry write path**: fire-and-forget, one bounded document per turn, and a
  throw leaves the reply byte-identical.
- **Job memory**: the drift scan streams with a cursor rather than buffering
  documents with their full text.
