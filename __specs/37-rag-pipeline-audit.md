# 37 — RAG Pipeline Audit

Stage by stage, as the code stands today. Every claim carries a `file:line`, a
harness number or a telemetry query. Where a number does not exist, this says so
rather than estimating.

**Read the flag table first.** Four of the quality features built in P3, P5, P7
and P11 ship **disabled by default**, so the pipeline a fresh deployment runs is
not the pipeline the codebase contains.

---

## 0. What is actually switched on

| Capability | Flag | Default | Where |
| --- | --- | --- | --- |
| Hybrid dense + lexical retrieval | `KB_HYBRID_ALPHA` | **on** (0.7) | `config/env.ts:118` |
| Grounded prompting + citations | none, unconditional | **on** | `finalize.node.ts:145` |
| Per-turn telemetry | `RAG_TELEMETRY_ENABLED` | **on** | `config/env.ts:263` |
| Quality alerts | `RAG_ALERT_ENABLED` | **on** | `config/env.ts:292` |
| Query rewriting / expansion | `AI_QUERY_REWRITE_ENABLED` | **off** | `config/env.ts:79` |
| HyDE | `AI_QUERY_HYDE_ENABLED` | **off** | `config/env.ts:91` |
| Follow-up retrieval round | `AI_QUERY_FOLLOWUP_ROUND_ENABLED` | **off** | `config/env.ts:95` |
| Cross-encoder reranking | `KB_RERANK_ENABLED` | **off** | `config/env.ts:132` |
| Contradiction detection | `KB_CONFLICT_DETECTION_ENABLED` | **off** | `config/env.ts:163` |
| Index-health job | `KB_INDEX_HEALTH_ENABLED` | **off** | `config/env.ts:202` |

So the default path is: **embed query → hybrid dense+lexical → RRF → context
block with enforced citations → answer → telemetry.** No rewrite, no rerank, no
conflict check.

---

## 1. Ingestion

`POST /knowledge/{text,upload,website}` (`kb.routes.ts:89,113,164`) →
`ingestSource()` (`ingestion.service.ts:74`).

| Stage | Where | Notes |
| --- | --- | --- |
| Signature check | `kb.routes.ts` → `file-signature.ts` | Magic bytes vs the declared type. Executables refused whatever they claim |
| Parse | `parsers.ts:106` | Whole file in a `Buffer`; 25MB multer cap (`kb.routes.ts:28`) |
| Hash | `ingestion.service.ts:103,107` | SHA-256 of normalised text; `agentId + contentHash` is unique (`KnowledgeSource.ts:96`) |
| Budget gate | `ingestion.service.ts:186` | Over-budget orgs park in `error` with a readable reason, not a crash |
| Chunk | `chunker.ts:39` | 1200 chars, 150 overlap |
| Embed | `embedding.service.ts` | Batches of 96, sequential, retry + backoff |
| Upsert | `ingestion.service.ts:~220` | Vector id `sourceId:chunkIndex` |
| Stale cleanup | `ingestion.service.ts:256-258` | Upsert first, then delete only ids the new chunking no longer produces |
| Mirror (P4) | `ingestion.service.ts:~265` | `KbChunk` rows: lexical leg + untruncated passage text |
| Stage events (P8) | `ingestion-events.ts` | One run id ties every stage of an attempt together |

### Failure modes

| # | Failure | Trigger | Severity | Confidence |
| --- | --- | --- | --- | --- |
| I1 | Embedding batch partially fails mid-source | Provider 5xx on batch *k* of *n* after batches 1..k-1 succeeded | **High** | High — `ingestSource` has no per-batch checkpoint; the catch marks the whole source `error` and the next attempt re-embeds from scratch, re-paying for 1..k-1 |
| I2 | Vectors upserted, `KbChunk` mirror write fails | Mongo unavailable between the Pinecone upsert and the mirror insert | Medium | High — ordering is deliberate (`ingestion.service.ts` comment: vectors first so a failure leaves searchable vectors rather than orphan rows), but the lexical leg is then blind to that source until re-ingest |
| I3 | A 25MB text file produces 26,162 chunks → 273 sequential embedding batches | One large upload | Medium | **Measured** (§5) |
| I4 | Zero-chunk ingest reported as success | Scanned PDF with no text layer | Low | High — handled: `empty` is its own status, and the reconcile job deliberately does not retry it |
| I5 | Deploy mid-ingest loses the run | Restart while `ingestSource` is in flight | Low | High — `embedding-reconcile.job.ts:185` re-queues sources stuck in `processing` past `KB_INGEST_STUCK_PROCESSING_MS` |

## 2. Retrieval

`searchKb()` (`search.service.ts:34`), optionally wrapped by `understoodSearch()`
(`understood-search.ts:50`) when the P3/P5/P7 flags are on.

- **Tenancy** is enforced on every leg: an AND-ed metadata filter on
  `organizationId` and `agentId` (`search.service.ts:152`), and a query with no
  `agentId` is **refused**, not widened (`search.service.ts:57`). Asserted by
  `vector-tenancy.test.ts`.
- **Dense** (`search.service.ts:131`) and **lexical** (`lexical-search.service.ts`)
  run concurrently; the lexical leg is an enhancement with its own timeout.
- **Fusion** is RRF on rank (`fusion.ts`), because cosine and MongoDB text scores
  are not on comparable scales.
- **Hydration** (`search.service.ts:110`) reads passage text from the `KbChunk`
  mirror, not from Pinecone metadata.

### Failure modes

| # | Failure | Trigger | Severity | Confidence |
| --- | --- | --- | --- | --- |
| R1 | `topK` is fixed regardless of KB size | A corpus that grows past the point where 8 passages sample it usefully | **High** | Medium — no measurement exists; see §5 and the open question in `38-scale-and-load-risks.md` |
| R2 | Cosine floor `AI_KB_SEARCH_MIN_SCORE` is not comparable across queries | Any query phrased less directly than the documents | **High** | High — this is the documented reason reranking exists (`42-reranking.md`), and reranking is off by default |
| R3 | Widen-on-empty pushes zero-relevance passages into the prompt | Floor filters everything, reranking off | Medium | High — gated on `!env.kb.rerankEnabled` (`kb-retriever.ts`), so it is *active* in the default configuration |
| R4 | Vector-store outage degrades to zero hits | Pinecone unavailable | Low | High — deliberate (`search.service.ts:160`); the reply still happens, ungrounded, and the model is told there are no passages |
| R5 | Tenancy rests on one metadata filter, not namespaces | n/a | Medium | High — `04-pinecone-firecrawl.md` "Vector-store tenancy"; not a live leak, a weaker partition |

## 3. Generation

`finalize.node.ts`. Two concurrent calls (`:180-181`): a streamed prose reply and
a structured meta pass for confidence, action and quick replies.

- **Context block** (`:145`) numbers the passages and `assertVerbatim` checks the
  text handed to the model is byte-identical to the retrieved passage.
- **Citations** are validated (`citation-validator.ts`); markers pointing at
  nothing are stripped.
- **Uncited-ratio signal**: past `AI_MAX_UNCITED_RATIO`, confidence is lowered
  below `AI_CONFIDENCE_THRESHOLD`. Note what that does and does not do: the only
  consumer of the threshold is `rag-telemetry.service.ts`, which sets the turn's
  `lowConfidence` flag. Nothing escalates on confidence, so this surfaces the
  turn on the quality dashboard and in the alert sweep and changes nothing about
  the answer. Comments in `finalize.node.ts` and `config/env.ts` claimed
  otherwise and have been corrected; the behaviour is deliberately unchanged and
  stays open as A20 in `45-deferred-decisions.md`.

### Failure modes

| # | Failure | Trigger | Severity | Confidence |
| --- | --- | --- | --- | --- |
| G1 | Meta pass fails → confidence defaults to 0.5, action to `reply` | Provider error; **observed live** with a 402 | Medium | **Observed** — the turn still answers and is marked low-confidence, which is the designed degradation |
| G2 | Streamed reply fails → generic apology, Sentry event | Provider outage | Medium | High |
| G3 | A grounded answer can still be wrong if retrieval was wrong | Confidently misleading passage | **High** | High — this is what sampled faithfulness (P9) exists to detect, and it is a detector, not a control |
| G4 | Citation markers are validated for *existence*, not for *support* | Model cites [2] for a sentence [2] does not support | Medium | High — support is only checked by the sampled judge |

## 4. Delivery and telemetry

`runner.ts`. Reply persisted and emitted, then `recordRagTurn` fire-and-forget
(`runner.ts:26`), then usage (`:403`).

- A throw inside telemetry leaves the reply byte-identical (asserted in
  `rag-telemetry.test.ts`).
- Cost is backfilled from the usage call; an unresolved cost is **null**, not
  zero (fixed in the review pass — see `CHANGELOG_1.md` §2).

| # | Failure | Trigger | Severity | Confidence |
| --- | --- | --- | --- | --- |
| D1 | Cost never resolves for a turn | OpenRouter `/generation` 404s past the retry budget | Low | **Measured**: 2 of 1,516 usage rows (0.13%) are give-ups |
| D2 | Telemetry write fails | Mongo blip | Low | High — logged and swallowed by design |

---

## 5. Measured numbers

**Provenance and its limits.** Latency and confidence come from **4**
`RagTurnMetric` rows in the development database. Four is not a distribution: the
p50 below is a midpoint of four samples and there is **no meaningful p95**. Cost
comes from 1,516 `UsageRecord` rows, which is a real sample. Retrieval quality
comes from the P2 harness against the 45-case fixture set.

| Metric | Value | Source |
| --- | --- | --- |
| Turn wall time (4 samples) | 7.9s / 10.9s / 21.3s / 31.5s | `ragturnmetrics.durationMs` |
| Retrieval latency | 0 / 3.9s / 10.0s / 17.0s | `retrieval.latencyMs` |
| Generation latency (finalize) | 1.9s / 2.3s / 2.6s / 4.2s | `generation.latencyMs` |
| **Cost per answered turn** | **$0.0158** | $0.9978 over 63 `widget_reply` rows |
| Prompt tokens per turn | ~7,358 | 463,548 / 63 |
| Completion tokens per turn | ~120 | 7,545 / 63 |
| Embedding cost | $0.0000201 per 1k tokens | $0.00048284 over 24,142 tokens |
| Cost never resolved | 0.13% of usage rows | `promptTokens:0 AND generationIds.0 exists` |
| Recall@5 (fixture set, 45 cases) | **0.919** | latest report `2026-08-28T11-32-04` |
| MRR | 0.892 | same |
| Harness p50 / p95 retrieval+generation | 2,299ms / 2,885ms | same |
| Ingestion: 25MB text file | 26,162 chunks, 273 embed batches, parse 20ms, chunk 64ms | measured, §Part D |

**Retrieval quality moved.** Across the last four 45-case runs, Recall@5 went
0.703 → 0.784 → 0.892 → **0.919** and MRR 0.689 → 0.770 → 0.865 → **0.892**.
Those runs bracket the hybrid-retrieval and fusion work.

**Faithfulness is unmeasured.** Every one of the 48 stored reports has
`faithfulness: null` — 47 ran with the judge skipped, and the single run with
`judgeCalls: 19` recorded a null cost. There is **no measured faithfulness number
for this system**, offline or online.

---

## 6. What this looked like before P2

Reconstructed from `E2E_FLOW.md` as it stood at commit `8012b15b` (the document
described the pipeline before this work and was accurate for it):

| Then | Now |
| --- | --- |
| Dense-only Pinecone query | Dense + lexical, RRF-fused, mirror-hydrated |
| Passage text lived in Pinecone metadata, truncated at 8000 chars | `KbChunk` mirror holds untruncated text; Pinecone is an index again |
| Passages handed to the model as a tool-result blob | Numbered context block, verbatim-asserted, citations validated |
| No notion of whether an answer was supported | Uncited-ratio control lowers confidence; sampled judge scores faithfulness |
| No retrieval quality measurement of any kind | 45-case golden set, Recall/Precision/MRR/nDCG, run before and after a change |
| No per-turn record | `RagTurnMetric` per turn incl. per-chunk records |
| Ingestion failures were a status field | Stage events, error taxonomy, health alerts |
| Nothing knew which passages were weak | Index health: dead weight, misleading, retrieved-not-cited |

The single biggest change is not a feature: **before P2 there was no way to tell
whether a retrieval change helped.** Everything else is downstream of that.

---

## 7. Top 10 remaining quality risks

Ranked by expected cost to answer quality, given the default flag state.

| # | Risk | Why it ranks here | What would address it |
| --- | --- | --- | --- |
| 1 | **Reranking is off**, so the only relevance signal is an uncalibrated cosine score | R2 is the documented reason reranking was built; with it off, `AI_KB_SEARCH_MIN_SCORE` is either too tight or too loose for every query | Decide `KB_RERANK_ENABLED` from the table in Part E.3 |
| 2 | **Faithfulness has never been measured**, offline or online | The hallucination metric is null in all 48 reports; sampled online judging has never produced a score | Fund one full eval run with the judge, and one week at `RAG_FAITHFULNESS_SAMPLE_RATE=0.05` |
| 3 | **Query rewriting is off**, so follow-ups retrieve on the raw utterance | "what about the annual one?" embeds as itself | Decide `AI_QUERY_REWRITE_ENABLED` against its measured ~2.5s p95 cost |
| 4 | Widen-on-empty is active in the default config (R3) | Pushes zero-relevance passages into a prompt that instructs the model to cite them | Ships off automatically when reranking is on; otherwise gate it separately |
| 5 | Fixed `topK` regardless of corpus size (R1) | 8 passages sample a 50-document KB and a 50,000-document KB identically | Measure Recall@K against corpus size; see `38-scale-and-load-risks.md` |
| 6 | Citations are validated for existence, not support (G4) | A plausible answer citing the wrong passage passes every automated check | The sampled judge is the only detector; raise the rate or add a citation-support check |
| 7 | Contradiction detection is off (P7) | Two sources disagreeing produces a confident answer from whichever ranked higher | Decide `KB_CONFLICT_DETECTION_ENABLED`; cost is one LLM call on the minority of turns where the top two scores are close |
| 8 | Partial embedding failure re-pays for work already done (I1) | A large source failing on batch 200 of 273 re-embeds all 273 | Per-batch checkpointing in `ingestSource` |
| 9 | Retrieval latency dominates the turn | Measured 10.0s and 17.0s of turns that took 21.3s and 31.5s | Profile the dense/lexical/hydrate split; no per-leg telemetry exists yet |
| 10 | Telemetry sample is too small to act on | 4 turns; the dashboard's own p95 is not a p95 | Accumulate real traffic before tuning anything from it |

**Risks 1, 3 and 7 are not defects.** They are decisions parked with a default,
and the evidence for changing them is in Part E.
