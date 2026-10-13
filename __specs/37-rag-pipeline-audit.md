# 37 — RAG Pipeline Audit

Stage by stage, as the working tree stands on 2026-10-09 (after P1-P11 and the
review passes in `CHANGELOG_1-4`). Every claim carries a `file:line` (paths are
relative to `apps/api/src/` unless they start with a top-level folder), a
harness number, a telemetry query, or a measurement made for this audit.

> **Status, 2026-10-10.** Sections 1-7 are the audit as written, kept as the
> record of what was found and with what evidence. The follow-up fix pass is in
> **§8**, which says per finding what changed, where, and how it was verified.
> Where §1-7 and §8 disagree about current behaviour, §8 is current.

## How to read the numbers

Every number in this document has one of five provenances, and they are not
interchangeable:

| Tag | Meaning |
| --- | --- |
| **[measured]** | Measured for this audit, on this machine, on 2026-10-09. The script and its output are described where the number appears |
| **[recorded]** | Measured by an earlier phase and written into a spec. The spec line is cited. The raw report behind it no longer exists: `packages/rag-eval/reports/` is empty and git-ignored (`packages/rag-eval/reports/.gitignore`) |
| **[telemetry]** | Read from the development database volume `csb-dev_mongo-data` |
| **[code]** | Read from source; behaviour, not a measurement |
| **[derived]** | Arithmetic over one of the above plus a stated price or assumption. Never presented as measured |

**The telemetry available is one turn.** The development database
(`csb-dev_mongo-data`, created 2026-09-07) holds exactly 1 `RagTurnMetric` row,
1 `UsageRecord`, 0 knowledge sources and 0 knowledge gaps. The previous version
of this document quoted 4 turns, 63 answered turns, 1,516 usage rows and a
7-source knowledge base; that database no longer exists on this machine (the
volume was recreated on 2026-09-07) and **none of those figures can be
reproduced**. They are not repeated here as if they were current. The other
project volume, `csb-full_mongo-data` (2026-06-07), predates the RAG work and
holds 2 knowledge sources and no telemetry.

**No new harness run was possible.** No `OPENROUTER_API_KEY`,
`EMBEDDING_API_KEY` or `PINECONE_API_KEY` is configured on this machine, and the
earlier audit recorded the OpenRouter balance as exhausted
(`__specs/45-deferred-decisions.md` §1, "402 ... exceed your available
credits"). Everything below that needs a model call is [recorded], [derived] or
listed as undetermined.

---

## 0. What is actually switched on

| Capability | Flag | Default | Where |
| --- | --- | --- | --- |
| Hybrid dense + lexical retrieval | `KB_HYBRID_ALPHA` | **on** (0.7) | `config/env.ts:124` |
| Grounded prompting + citations | none, unconditional | **on** | `services/ai/graph/nodes/finalize.node.ts:145` |
| Per-turn telemetry | `RAG_TELEMETRY_ENABLED` | **on** | `config/env.ts:266` |
| Sampled online faithfulness | `RAG_FAITHFULNESS_SAMPLE_RATE` | **0.05** | `config/env.ts:281` |
| Quality alerts | `RAG_ALERT_ENABLED` | **on** | `config/env.ts:295` |
| Query rewriting / expansion | `AI_QUERY_REWRITE_ENABLED` | **off** | `config/env.ts:79` |
| HyDE | `AI_QUERY_HYDE_ENABLED` | **off** | `config/env.ts:91` |
| Follow-up retrieval round | `AI_QUERY_FOLLOWUP_ROUND_ENABLED` | **off** | `config/env.ts:95` |
| Cross-encoder reranking | `KB_RERANK_ENABLED` | **off** | `config/env.ts:135` |
| Contradiction detection | `KB_CONFLICT_DETECTION_ENABLED` | **off** | `config/env.ts:166` |
| Index-health job | `KB_INDEX_HEALTH_ENABLED` | **off** | `config/env.ts:205` |

So the default path is: **embed query → dense + lexical → hybrid fusion →
hydrate from the mirror → numbered context block → answer + meta pass →
telemetry.** No rewrite, no rerank, no conflict check. **[code]**

---

## 1. Ingestion

There are **two** ingestion pipelines, and they are not equivalent.

| Entry | Pipeline | Used for |
| --- | --- | --- |
| `POST /knowledge/text`, `/upload`, re-ingest, reconcile | `ingestSource()` `services/kb/ingestion.service.ts:74` | Files, pasted text, single URLs, **and any re-ingest of a website** |
| Firecrawl crawl completion | `ingestCrawlResults()` `services/kb/firecrawl.service.ts:83`, called from `jobs/firecrawl-ingest.job.ts:130` | **The first ingest of every crawled website** |

### `ingestSource` (the full pipeline)

| Stage | Where | Notes |
| --- | --- | --- |
| Upload limits | `routes/kb.routes.ts:26-28` | `multer.memoryStorage()`, 25MB `fileSize` cap: the whole file is a `Buffer` in the API process |
| Signature check | `services/kb/file-signature.ts` | Magic bytes against the declared type |
| Parse | `services/kb/parsers.ts:106` | In memory, per type (`:44` PDF, `:59` DOCX, `:67` spreadsheet/CSV, `:83` text, `:87` HTML) |
| Status → `processing` | `ingestion.service.ts:94` | |
| Hash | `ingestion.service.ts:103,107` | SHA-256 of normalised text; `(agentId, contentHash)` is unique (`models/KnowledgeSource.ts:96`) |
| Chunk | `ingestion.service.ts:138` (per crawled page), `:148` (everything else); `utils/chunker.ts:39` | 1200 chars, 150 overlap, heading path per chunk |
| Empty → `empty` | `ingestion.service.ts:161-168` | Own status, not retried |
| Budget gate | `ingestion.service.ts:185-192` | After chunking, before any provider spend. Over-budget → `error` with a readable reason |
| Embed | `ingestion.service.ts:204`; `services/ai/embedding.service.ts:140-141` | **One call for the whole source**, internally sequential batches of `EMBEDDING_BATCH_SIZE` (96) |
| Upsert | `ingestion.service.ts:221`; `config/pinecone.ts:101,130` | Vector id `sourceId:chunkIndex`, sequential batches of 100, retried |
| Stale-vector cleanup | `ingestion.service.ts:256-258` | After the upsert: delete only ids the new chunking no longer produces |
| Mirror (P4) | `ingestion.service.ts:267-269` | `KbChunk` rows replaced wholesale per source |
| Status → `synced` | `ingestion.service.ts:289` | |
| Failure | `ingestion.service.ts:297-323` | Classified `error`; `partial_upsert` when the failure was at or after the upsert (`:308`); `retryCount` bumped |
| Stage events (P8) | `ingestion.service.ts:121,180,211,249,260,323` | One run id per attempt, `run.ok`/`run.failed` per stage |

### `ingestCrawlResults` (the crawl pipeline)

A hand-written copy of the above that **diverges in four ways**. **[code]**

| | `ingestSource` | `ingestCrawlResults` |
| --- | --- | --- |
| `KbChunk` mirror (P4) | written (`ingestion.service.ts:267-269`) | **not written**: no `KbChunk` reference anywhere in `firecrawl.service.ts` |
| Stage events (P8) | yes | **none** |
| Heading path in the embedded text | yes (`embeddableText`) | **no**: raw `c.text` is embedded (`firecrawl.service.ts:145`) |
| Zero chunks | `empty` (`ingestion.service.ts:162`) | **`synced`** with 0 chunks (`firecrawl.service.ts:122`) |

The mirror only appears for a website when something later re-ingests it
through `ingestSource`, which recovers the pages from the stored text
(`ingestion.service.ts:131`, `splitCrawledPages`). Until then a crawled website
has **no lexical leg** (the `$text` query reads `KbChunk`), its passages are
hydrated from Pinecone metadata (`services/kb/search.service.ts:221-222`), and
it is **invisible to passage-level index health**, which lists passages from
`KbChunk` (`services/kb/index-health.service.ts:328-354`).

### Measured: ingesting a 25MB upload  [measured]

The real `parseFile → chunkText → embed` path (the pseudo-embedding branch at
`embedding.service.ts:126-134`, which produces real 1536-dimension vectors and
batches exactly like the provider path), one 24.9MB file per process:

| File | Chunks | Embed batches | Parse | **Chunk** | Embed (pseudo) | Peak RSS |
| --- | --- | --- | --- | --- | --- | --- |
| `.txt`, heading every paragraph | 25,222 | 263 | 0.3s | **40.8s** | 19.2s | 944MB |
| `.csv` | 25,833 | 270 | 11.9s | **537.1s** | 11.0s | 917MB |

The chunker is quadratic on two common shapes, and it is synchronous code in the
API process, so this time is **a blocked event loop**: no HTTP response, socket
message or streamed reply for any tenant on that instance. Detail and the
other file types are in `38-scale-and-load-risks.md` §1.

### Failure modes

| # | Failure | Trigger | Severity | Confidence |
| --- | --- | --- | --- | --- |
| I1 | **Event loop blocked for seconds to minutes by chunking** | A CSV over ~1MB (1.5s at 1MB, 83s at 8MB) or heading-dense markdown over ~4MB (1.2s at 4MB, 40.8s at 25MB). Cause: unbounded `lastIndexOf` at `utils/chunker.ts:53-54` and a linear heading scan per chunk at `utils/markdown-structure.ts:68-75` | **Critical** | **Measured** |
| I2 | **Crawled websites skip the mirror, stage events and heading paths** | Every first crawl | **High** | High, code |
| I3 | Embedding batch partially fails mid-source | Provider error on batch *k* of *n*: `embed()` throws for the whole list (`ingestion.service.ts:204`), the source goes to `error`, and the retry re-embeds and re-pays for batches 1..*k*-1 | Medium | High, code |
| I4 | Orphan vectors after a `partial_upsert` | Attempt A upserts some of its ids then fails, so `pineconeIds` is never updated (`ingestion.service.ts:287` is not reached). A later success with fewer chunks computes stale ids from the *old* recorded list (`:214,256`), so A's extra ids are never deleted. They stay retrievable and are hydrated from their metadata text (`services/kb/search.service.ts:222`) | Medium | Medium-high, code. Requires a partial upsert followed by a shrinking re-ingest |
| I5 | Zero-chunk crawl reported as success | A crawl whose pages have no markdown: `synced`, 0 chunks (`firecrawl.service.ts:122`) | Low | High, code. Inconsistent with the `empty` status everything else uses |
| I6 | Deploy mid-ingest loses the run | Restart while an ingest is in flight | Low | High, code: recovered by `jobs/embedding-reconcile.job.ts:186-214` after `KB_INGEST_STUCK_PROCESSING_MS` (15 min, `config/env.ts:184`) |
| I7 | Two API replicas run the reconcile and crawl loops twice | `coolify/docker-compose.production.yml:46` sets `replicas: 2`; `serialLoop` is per-process (`jobs/serial-loop.ts`) | **High** | High, config. Contradicts `RUNBOOK.md` §10.3, which says exactly one replica |

---

## 2. Retrieval

`search_kb` (`services/ai/tools/builtin.tools.ts`) → `understoodSearch()`
(`services/ai/retrieval/understood-search.ts:50`) → `KbRetriever.searchHits()`
(`services/ai/retrieval/kb-retriever.ts:103`) → `searchKb()`
(`services/kb/search.service.ts:34`).

| Step | Where | Notes |
| --- | --- | --- |
| Plan | `understood-search.ts:68-78` | Rewrite only when `AI_QUERY_REWRITE_ENABLED`; otherwise the model's own query |
| Tenancy guard | `services/kb/search.service.ts:56-61`; `services/kb/lexical-search.service.ts:35-43` | An empty `agentId` (or `organizationId`, lexical) is **refused**, not widened |
| Dense | `services/kb/search.service.ts:152-154` | Pinecone filter `$and: [agentId $eq, organizationId $eq]` |
| Lexical | `lexical-search.service.ts:46` | Mongo `$text` with `organizationId` + `agentId`, under `KB_LEXICAL_TIMEOUT_MS` (1500ms, `config/env.ts:129`); failure degrades to dense-only (`services/kb/search.service.ts:73-82`) |
| Hybrid fusion | `services/kb/hybrid-fusion.ts:53` | Dense floor applied before fusion (`services/kb/search.service.ts:90`) |
| Hydrate | `services/kb/search.service.ts:110,197-231` | Text from `KbChunk` by `chunkId` + `organizationId` |
| Widen on empty | `kb-retriever.ts:121-126` | Retry with `minScore: 0`, only when reranking is **off** |
| Variant fusion | `services/ai/retrieval/fusion.ts:46` | RRF across paraphrases / follow-up, only when rewriting is on |
| Rerank (P5) | `services/ai/retrieval/rerank.ts:173` | Only when `KB_RERANK_ENABLED` |
| Conflict (P7) | `understood-search.ts:163-170`; `services/kb/conflict.ts` | Only when `KB_CONFLICT_DETECTION_ENABLED` |
| Gap record | `builtin.tools.ts:36-46` | Best score below `AI_KB_GAP_SCORE_THRESHOLD` → `KnowledgeGap` upsert |

### Measured: the lexical leg does not scale with the tenant  [measured]

The `$text` index on `KbChunk` is not prefixed by tenancy
(`models/KbChunk.ts:62-65`), and MongoDB answers a `$text` query from the text
index, so the `organizationId`/`agentId` clause is applied **after** matching
across every tenant. The comment at `models/KbChunk.ts:67-68` assumes the
separate `{organizationId, agentId}` index serves this query; `explain()` shows
it does not.

| Tenant queried | Other tenant's chunks | Returned | Keys examined | Docs examined | Time |
| --- | --- | --- | --- | --- | --- |
| 200 chunks | 100,000 | 8 | **200,400** | **200,400** | **8,530ms** |

At that size the query exceeds the 1500ms lexical timeout on every search, so
**every tenant silently degrades to dense-only** (`services/kb/search.service.ts:73-82`) once
the platform's combined corpus is large enough. Throwaway mongod 8.2.6, script in
`38-scale-and-load-risks.md` §3.

### Failure modes

| # | Failure | Trigger | Severity | Confidence |
| --- | --- | --- | --- | --- |
| R1 | **Lexical leg times out platform-wide as the shared corpus grows** | ~100k matching chunks across all tenants (measured 8.5s, timeout 1.5s) | **High** | **Measured** |
| R2 | Cosine floor `AI_KB_SEARCH_MIN_SCORE` is not comparable across queries | Any query phrased less directly than the documents | High | High; this is the stated reason reranking exists (`__specs/42-reranking.md`), and reranking is off |
| R3 | Widen-on-empty pushes zero-relevance passages into the prompt | Floor filters everything, reranking off (`kb-retriever.ts:121`) | Medium | High, code |
| R4 | Deleted content can still be served | A source deleted while its vectors survive (Pinecone delete failed, or I4). `hydrate` never drops a hit whose source is gone: it falls back to metadata text and the title "Untitled" (`services/kb/search.service.ts:221-222`) | Medium | High, code |
| R5 | Fixed `topK` regardless of KB size | Large corpora | Medium | **Undetermined**: no corpus larger than 8 chunks has ever been measured here (see §6) |
| R6 | `stale` and `priority` do nothing in the default configuration | `stale` is read by nothing in retrieval. `priority` is read only by `services/kb/conflict.ts:120-121`, which runs only with `KB_CONFLICT_DETECTION_ENABLED` (off). So P11's "Mark stale / lower authority" and the "high-priority" gap answer do not change what a customer is told | Medium | High, code |
| R7 | Vector tenancy rests on one metadata filter, not namespaces | n/a | Medium | High: `services/kb/search.service.ts:152-154`; namespaces noted as future hardening at `ingestion.service.ts:216-219` |

---

## 3. Generation

`finalize.node.ts:136-294`. Two concurrent calls (`:179-182`): the streamed
customer reply (`:57-76`) and a structured meta pass (`:79-101`) for confidence,
action and quick replies.

- **Context block.** `buildContextBlock` (`services/ai/context-block.ts:137`)
  numbers, dedupes and token-budgets the passages (`AI_CONTEXT_TOKEN_BUDGET`
  3000, `config/env.ts:103`); `assertVerbatim` (`context-block.ts:193`) checks
  the text is byte-identical to the retrieved passage (`finalize.node.ts:150`).
- **No evidence, no block.** With no passages the model is told to say it does not
  know rather than given an empty header (`finalize.node.ts:159-162`).
- **Citations** are validated for existence (`services/ai/citation-validator.ts:87`,
  `finalize.node.ts:226`).
- **Uncited-ratio signal** (`finalize.node.ts:248-261`) lowers confidence below
  `AI_CONFIDENCE_THRESHOLD`. Its only consumer is the telemetry flag
  (`services/ai/telemetry/rag-telemetry.service.ts:188`). It does not escalate;
  the comment at `finalize.node.ts:236-247` says so, and this is A20 in
  `45-deferred-decisions.md`.

### What the model is actually shown

| # | Finding | Where | Severity | Confidence |
| --- | --- | --- | --- | --- |
| G1 | **History is the first 20 messages, not the last 20.** `Message.find(...).sort({ createdAt: 1 }).limit(20)` returns the oldest. Past 20 messages, everything between message 20 and the current turn is invisible to the model. The comment at `services/ai/graph/runner.ts:82` says "recent history"; `__specs/05` "Context Window Management" documents the last 50 | `services/ai/graph/runner.ts:190-192` | **High** | High, code |
| G2 | **The current customer message is sent twice** on conversations under 20 messages: the socket and widget paths persist it before calling `generateAiReply` (`socket/handlers/message.handler.ts:57-64`), the history query returns it, and `buildInitialMessages` appends it again | `services/ai/graph/runner.ts:106-112` | Medium | High, code |
| G3 | Operator messages are replayed to the model as **customer** messages: every non-`ai` row becomes a `HumanMessage` | `services/ai/graph/runner.ts:93-104` | Medium | High, code |
| G4 | **Hitting `AI_MAX_TOOL_TURNS` likely fails the reply.** The ceiling routes to `finalize` with the last message an assistant turn whose `tool_calls` have no `ToolMessage`s (`agent.graph.ts:30-35`); `finalize` sends `state.messages` unchanged (`finalize.node.ts:172-176`). OpenAI-compatible APIs reject an assistant `tool_calls` message without matching tool results, so both calls would fail and the customer gets the fallback apology (`:200`) at confidence 0.5. The ceiling test uses a scripted fake model that accepts it (`__tests__/ai-graph.test.ts:220`) | `agent.graph.ts:30`, `finalize.node.ts:175-176` | High | **Medium**: provider behaviour not exercised here (no key) |
| G5 | Meta pass fails → confidence 0.5, action `reply` | Provider error | Medium | **Observed**: the one real turn shows confidence exactly 0.5 and two generation ids where a full turn produces three **[telemetry]** |
| G6 | Streamed reply fails → generic apology + Sentry | Provider outage (`finalize.node.ts:189-201`) | Medium | High, code |
| G7 | A grounded answer can still be wrong if retrieval was wrong | Misleading passage | High | High; sampled faithfulness detects, it does not prevent |
| G8 | Citations are checked for existence, not support | Model cites [2] for a sentence [2] does not support | Medium | High, code; only the sampled judge checks support |

---

## 4. Delivery, escalation and telemetry

`services/ai/graph/runner.ts:115-470`.

- Reply streamed as `message:delta` to the contact room (`services/ai/graph/runner.ts:301-305`),
  persisted, then `message:done` (`:389`) and `message:new` (`:459-461`).
- Org conversation controls (`services/ai/graph/runner.ts:345-357`, `services/ai/shared/controls.ts:51`)
  downgrade `escalate` when the org disallows handoff and require a two-step
  resolve.
- `action === "escalate"` on an active conversation sets `escalated`
  (`services/ai/graph/runner.ts:442-444`).
- Usage is recorded fire-and-forget (`services/ai/graph/runner.ts:403`) and telemetry
  (`recordRagTurn`, `services/ai/graph/runner.ts:419`) carries the usage promise so cost is
  backfilled as **null, not zero**, when unresolved.

| # | Failure | Trigger | Severity | Confidence |
| --- | --- | --- | --- | --- |
| D1 | **The AI keeps answering after an operator joins over the socket.** The REST operator send flips `active → escalated` (`routes/message.routes.ts:83-86`); the socket send (`socket/handlers/message.handler.ts:57-80`) does not, so the next customer message still triggers `generateAiReply` | Operator replies from a socket client | Medium | High, code |
| D2 | Cost never resolves for a turn | OpenRouter `/generation` 404s past the retry budget | Low | Code: recorded as null. **The rate is undetermined**: the earlier "2 of 1,516 rows" came from a database that no longer exists |
| D3 | Telemetry write fails | Mongo blip | Low | High, code: logged and swallowed |

---

## 5. Measured numbers

| Metric | Value | Provenance |
| --- | --- | --- |
| Real turns recorded | **1** | [telemetry] `ragturnmetrics`, `csb-dev_mongo-data` |
| That turn: wall time | 11,301ms | [telemetry] `durationMs` |
| That turn: generation (finalize) | 3,371ms | [telemetry] `generation.latencyMs` |
| That turn: retrieval | not run (`searchCount: 0`, `toolTurns: 1`) | [telemetry] |
| That turn: tokens / cost | 4,573 prompt, 14 completion, **$0.009915**, `openai/gpt-4o` | [telemetry] `usagerecords` |
| p50 / p95 turn latency | **undetermined**: one sample | n/a |
| Recall@5 / MRR, 45-case set, alpha 0.7, rerank off | **1.000 / 0.912** | [recorded] `__specs/42-reranking.md:144-147` |
| Same, rerank on (floor 0.0005) | 0.919 / 0.892; "no evidence" rate 0.200 | [recorded] same |
| Alpha sweep: lexical leg contribution | Recall@5 0.973 → 1.000, MRR 0.856 → 0.912 | [recorded] `__specs/41-hybrid-retrieval.md:182` |
| Query rewrite: follow-up MRR | 0.550 → 1.000 | [recorded] `__specs/40-query-understanding.md:178` |
| Query rewrite latency | p50 2,324-2,918ms, p95 2,488-3,223ms (budget 400ms) | [recorded] `__specs/40-query-understanding.md:187-200` |
| Rerank call, 50 candidates | p50 1,155ms, p95 1,295ms (8 calls) | [recorded] `__specs/42-reranking.md:170` |
| Faithfulness, offline or online | **never measured** | `__specs/43-grounded-prompting.md:148-152` |
| Ingestion, 25MB text / CSV | see §1 | [measured] |
| Lexical leg at 100k other-tenant chunks | 8,530ms | [measured] §2 |

---

## 6. What this looked like before P2

From `E2E_FLOW.md` at the commits before the P-series and the specs each phase
wrote (`__specs/39-44`):

| Then | Now |
| --- | --- |
| Dense-only Pinecone query | Dense + lexical, fused, mirror-hydrated (for non-crawled sources, see I2) |
| Passage text in Pinecone metadata, truncated at 8000 chars | `KbChunk` mirror holds untruncated text, except for first-crawl websites |
| Passages handed to the model as a tool-result blob | Numbered context block, verbatim-asserted, citations validated |
| No notion of whether an answer was supported | Uncited-ratio signal; sampled judge built (never yet produced a score) |
| No retrieval quality measurement | 45-case golden set, Recall/Precision/MRR/nDCG, before-and-after on every retrieval change (`__specs/39`) |
| No per-turn record | `RagTurnMetric` per turn, with per-chunk records (`models/RagTurnMetric.ts`) |
| Ingestion failures were a status field | Stage events, error taxonomy, health alerts (for `ingestSource`; not for first crawls) |
| Nothing knew which passages were weak | Index health: dead weight, misleading, retrieved-not-cited |

The biggest change is still not a feature: **before P2 there was no way to tell
whether a retrieval change helped.** The biggest remaining gap is its mirror
image: there is still no way to tell whether an *answer* was right, because the
judge has never run.

---

## 7. Top 10 remaining quality risks

Ranked by expected cost to answer quality and availability, in the default
configuration.

| # | Risk | Evidence | What would address it |
| --- | --- | --- | --- |
| 1 | **Chunking blocks the event loop for every tenant** (I1) | Measured: 537s for a 25MB CSV, 1.5s at 1MB | Bound the backward search in `chunker.ts:53-54` to the window, binary-search `headingPathAt`, and move ingestion off the request process (`38` §1, §2) |
| 2 | **History is the oldest 20 messages** (G1), and the current message is duplicated (G2) | Code, `services/ai/graph/runner.ts:190-192`, `:106-112` | Sort descending, take the window, reverse; exclude the just-persisted message |
| 3 | **First-crawl websites have no lexical leg, no mirror, no stage events, no passage health** (I2) | Code, `firecrawl.service.ts:83-195` | Route crawl completion through `ingestSource` with a pages payload instead of a second pipeline |
| 4 | **Lexical leg degrades to dense-only platform-wide as the shared corpus grows** (R1) | Measured 8.5s vs 1.5s timeout at 100k chunks | Compound text index `{organizationId: 1, agentId: 1, text: "text", headingPath: "text"}` |
| 5 | **Faithfulness has never been measured** | `__specs/43-grounded-prompting.md:148-152`; 0 sampled turns in the 1-row telemetry | Fund one 45-case judged run and a week of sampling (`45` §1) |
| 6 | **Hitting the tool-turn ceiling likely returns the fallback apology** (G4) | Code; provider behaviour unverified | Strip or answer dangling `tool_calls` before `finalize`, and test against a real provider |
| 7 | Reranking off: relevance rests on an uncalibrated cosine floor (R2, R3) | [recorded] rerank turns 8/8 negative cases from noise into "no evidence" (`__specs/42-reranking.md:157`) at ~1.2s | Decision in `45` §3 |
| 8 | `stale` / `priority` have no effect by default (R6) | Code | Feed `priority` into fusion ordering, or label stale passages in the context block, or document that both only matter with conflict detection on |
| 9 | Deleted content servable from surviving vectors (R4, I4) | Code | Drop hits whose source is gone in `hydrate`; track ids before upsert |
| 10 | Production runs two API replicas against a one-replica design (I7) | `coolify/docker-compose.production.yml:46` vs `RUNBOOK.md` §10.3 | Set `replicas: 1` until the Socket.IO adapter and job locks exist |

**Risks 5 and 7 are decisions parked with a default, not defects.** The evidence
for them is in `45-deferred-decisions.md`. Risks 1, 2, 3, 4, 6, 9 and 10 are
defects with a known fix, for a follow-up; no product code is changed by this
audit.

---

## 8. Fix pass (2026-10-10)

Every defect in §1-4 that had a known fix, fixed, each with a test that fails on
the old behaviour where one could be written. Numbers below were re-measured on
the fixed code the same way §1-2 measured them. Decisions parked in
`45-deferred-decisions.md` §5 were not taken.

| # | Finding | Fix | Where | Verified by |
| --- | --- | --- | --- | --- |
| I1 | Quadratic chunking | Backward separator search bounded to the 200-char window it can use; heading path and protected-block lookups are binary searches. Output identical to the old algorithm | `utils/chunker.ts` (`lastIndexWithin`), `utils/markdown-structure.ts` | `__tests__/chunker-performance.test.ts` (equivalence over 60 generated documents plus CSV and no-separator text; 4MB CSV and 4MB heading-dense markdown under 1.5s). 25MB: markdown 40.8s → **0.16s**, CSV 537s → **0.08s**, HTML 486s → **0.03s** |
| I2, I5 | Crawl pipeline diverged | `ingestCrawlResults` stores the pages as text and calls `ingestSource`, so crawls get the mirror, stage events, heading paths and the `empty` status. The crawl job no longer overwrites a failure `ingestSource` already classified (it used to double-count the retry) | `services/kb/firecrawl.service.ts`, `jobs/firecrawl-ingest.job.ts` | `__tests__/ingestion-pipeline.test.ts` (mirror rows carry each page URL and heading path; re-crawl with fewer pages leaves no old vectors or rows; empty re-crawl is `empty` and removes old content) |
| I3 | Whole-source embed | Embed, upsert and mirror run per 256-chunk batch. A failure after any batch landed is classified `partial_upsert`. Batches already paid for are still re-embedded on retry (no per-batch checkpoint) | `services/kb/ingestion.service.ts` (`INGEST_BATCH`) | Same test file ("embeds and upserts in bounded batches"). Peak RSS for a 14.5MB ingest, same files, all-at-once vs batched: md 923 → **699MB**, csv 904 → **763MB**, html 872 → **743MB** (VmHWM; the same harness idles at 404MB, so the ingest itself went from ~470-520MB to ~295-360MB; at 5MB of text it adds ~70MB) |
| I4 | Orphan vectors after a partial upsert | Every id the run may write is recorded on the source before the first upsert; trimmed to the final set on success | `ingestion.service.ts` | "a run that dies after some batches landed leaves no vector the source does not know about", which also deletes the source and checks nothing is left |
| new | Zero-chunk re-ingest kept old vectors | The `empty` path deletes the previous run's vectors and mirror rows | `ingestion.service.ts` | Empty re-crawl test above |
| new | Text over 16MB could not be stored | Found while re-measuring §1: the 25MB files fail to save because `extractedText` lives on a MongoDB document (16MB cap). The upload returned a raw 500; the ingest path's catch block failed on the same field and left the source in `processing`. Now a 15MB cap: the upload is refused with a readable 400, and ingest/crawl end in a permanent `text_too_large` error | `ingestion.service.ts` (`MAX_EXTRACTED_TEXT_BYTES`), `routes/kb.routes.ts`, `ingestion-errors.ts` | `__tests__/text-size-limit.test.ts`; in the dashboard, a 16MB `.txt` is refused in the upload dialog (`QA_TEST_RESULTS_5.md`) |
| I7 | Two replicas | `replicas: 1` for the API in the production compose, with the reason in place | `coolify/docker-compose.production.yml` | Config |
| S2 (`38`) | DOCX parse broken | `@xmldom/xmldom` override scoped to `^0.8` so `mammoth` gets 0.8.15; CSV read as text instead of through SheetJS | `package.json`, `pnpm-lock.yaml`, `services/kb/parsers.ts` | `__tests__/parsers.test.ts` (real DOCX, PDF, CSV byte-identical, XLSX, HTML); DOCX and CSV uploaded and synced in the dashboard |
| R1 | Lexical leg scanned every tenant | Text index prefixed with `{organizationId, agentId}` | `models/KbChunk.ts` | `__tests__/scale-indexes.test.ts`. 200 tenant chunks next to 20,000 others: 40,400 keys and docs in 279ms → **400 keys, 200 docs, 2ms** |
| R4 | Deleted content servable | `hydrate` drops hits whose source is not found for the org, and logs it | `services/kb/search.service.ts` | `__tests__/deleted-source-hits.test.ts` |
| G1, G2 | Oldest 20 messages; current message twice | Newest 20 by `createdAt` desc, reversed; the just-persisted customer message is dropped from history | `services/ai/graph/history.ts` | `__tests__/turn-history.test.ts` |
| G3 | Operator messages replayed as the customer | Operator rows become assistant messages prefixed `[Human support agent]`; system rows are skipped | `services/ai/graph/runner.ts` (`buildInitialMessages`) | Same file |
| G4 | Dangling `tool_calls` at the ceiling | `finalize` answers every unanswered call with a `notRun` tool result before calling the model; the tools node does the same for calls after a `halt` in the same step | `graph/nodes/finalize.node.ts` (`answerDanglingToolCalls`), `graph/nodes/tools.node.ts` | `__tests__/ai-graph.test.ts`: the stub model now rejects any unpaired call, as providers do; both tests fail on the old code |
| D1 | Socket operator send did not take over | Socket send flips `active → escalated` like the REST route, emits `conversation:updated`, and emits `message:new` to the conversation and visitor rooms (it only reached the org room before) | `socket/handlers/message.handler.ts` | `__tests__/socket-message-auth.test.ts`. No shipped client sends over the socket today, so this is reachable only from a custom client |
| `38` S6 | Unbounded concurrent turns, no turn deadline | `AI_MAX_CONCURRENT_TURNS` (16) per-process queue at the `generateAiReply` seam; `AI_TURN_DEADLINE_MS` (90s) aborts the graph run into the fallback reply | `services/ai/turn-gate.ts`, `graph/runner.ts` | `__tests__/turn-gate.test.ts`; the stalled-model test in `rag-telemetry.test.ts` returns in under 0.5s and times out without the signal |
| `45` §2 | `reembed --resume` blind to model changes; loads all text | `KnowledgeSource.embeddingModel` stamped at ingest; resume skips only complete sources on the current model; cost summed in MongoDB and sources walked with a cursor | `scripts/reembed.ts`, `services/kb/reembed-plan.ts` | `__tests__/ingestion-pipeline.test.ts`; end-to-end run on a seeded database: the old-model source re-embedded on the first `--resume`, all three skipped on the second |
| new (2026-10-13) | Budget pause burned retries, then never resumed | The ingest budget gate wrote no `embeddingErrorCode`, so reconcile read it as `unknown`, spent all three attempts and alerted "exhausted". A source that did carry `budget_exceeded` was skipped on every tick forever. The gate now records `budget_exceeded`; reconcile skips it only while `orgBudgetStatus` still says exceeded | `services/kb/ingestion.service.ts`, `jobs/embedding-reconcile.job.ts` | `__tests__/ingestion-pipeline.test.ts` (over-budget run is coded), `__tests__/ingestion-observability.test.ts` (resumes after reset; fails on the old job) |
| new (2026-10-13) | Reconcile double-counted failed retries; budget-paused sources held the retry batch | The job did `$inc: retryCount` before calling `ingestSource`, whose catch increments again, so a failed retry spent two attempts and a transient failure got one retry instead of two. Separately, paused sources stayed in the 20-row `error` query all month: each wrote a "waiting" event every tick, and 20 of them starved every other org's retries. The job no longer increments, and checks the budget once per paused org and excludes still-over-budget orgs' paused sources from the query. The gate records the pause as one `skipped` event | `jobs/embedding-reconcile.job.ts`, `services/kb/ingestion.service.ts` | `__tests__/ingestion-pipeline.test.ts` "reconcile retries" (three tests, all fail on the previous job) |

**Still open.** Peak memory for the largest storable document (~700-760MB in the
measuring harness, of which ~300-360MB is the ingest) is still above the 512MB
production container limit; what remains is
parse, chunk and the mirror text, not vectors. Closing it means a lower per-type
upload cap or ingestion in a worker process, both owner decisions
(`45-deferred-decisions.md`). Risks 5 and 7 in §7 are unchanged decisions.
Failed batches are re-embedded and re-paid on retry (I3, cost only).
