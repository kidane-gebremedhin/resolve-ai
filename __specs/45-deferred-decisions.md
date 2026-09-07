# 45 — Deferred Decisions, With Data

Every decision parked with a default during P1-P11, presented as: what the
default was, what the numbers now say, what changing it costs, and a
recommendation. **The decisions are the owner's; this document stops at the
recommendation.**

---

## 0. A gap in the evidence, stated first

**The P1-P11 changelogs no longer exist.** They were written to
`CHANGELOG_*.md`, a pattern that `.gitignore` excluded, so they were never
tracked and did not survive a clean. Git history holds seven changelogs, but they
are the project's *earlier* work (subscriptions, plans, usage tracking, admin
sessions) and predate the P-series entirely; none contains a "proceeded under
assumption" line.

So §4 below is **reconstructed** from code comments, spec text, and
`IMPLEMENTATION_AUDIT.md`. It is the best register that can be built from what
survives, and it is not the same thing as reading the originals. The one
assumption class most likely to be under-represented is P1-P8, whose changelogs
were written by earlier sessions and whose reasoning survives only where it was
also written into a spec or a comment.

**This is itself the first decision:** the pattern is now un-ignored, but
un-ignoring does not save an untracked file from `git clean`. Only committing
does.

---

## 1. Eval judge model and budget

**The default.** `RAG_EVAL_JUDGE_MODEL` and `RAG_FAITHFULNESS_JUDGE_MODEL` both
default to `anthropic/claude-sonnet-4.5`, with the online sampler at
`RAG_FAITHFULNESS_SAMPLE_RATE=0.05`. The judge is deliberately shared between the
offline harness and online sampling so the two faithfulness numbers are
comparable (`__specs/39`).

**What the numbers say.**

| | Value | Source |
| --- | --- | --- |
| Stored eval reports | 48 | `packages/rag-eval/reports/` |
| Reports with a faithfulness score | **0** | every one is `null` |
| Reports with judge calls | **1** (19 calls) | `2026-08-27T22-18-06` |
| Judge cost recorded on that run | **null** | cost settling never resolved |
| Answering cost, that 45-case run | $0.3551 | same report |
| Cost per answered production turn | **$0.0158** | $0.9978 / 63 `widget_reply` rows |

**There is no measured judge cost, and no measured faithfulness number, anywhere
in this system.** That is the finding. The one run that called the judge recorded
a null cost, so even that data point is unusable.

**What changing it costs.** Deriving rather than measuring, and flagged as such:
a judge call carries the question, reference answer, retrieved passages and the
answer under test, so roughly 1-3k prompt tokens and a few hundred completion
tokens. At Sonnet-class list pricing that is order **$0.01-0.02 per case**, so a
45-case run is order **$0.50-0.90** and the 10-case CI smoke order **$0.10-0.20**.
Online at 5% of turns, the judge adds order **$0.0005-0.001 per turn**, against a
measured $0.0158 answering cost, i.e. **3-6% overhead**.

Substituting a cheaper judge cannot be assessed: agreement between two judges on
the same cases needs both to have run, and neither has.

**Recommendation.** Fund one full 45-case run with the judge enabled and one week
of online sampling at the current rate, then decide. The overhead is small enough
that the cheaper-judge question is probably not worth answering; the *absence of
any faithfulness number* is the real problem, and it is ranked #2 in
`__specs/37`. Budget order $1 offline and single-digit dollars per month online.

**Blocked here:** the OpenRouter balance on this account is exhausted (observed
`402 ... exceed your available credits` during this audit), so no run was
possible.

---

## 2. Reindex tolerance

**The default.** `scripts/reembed.ts` backfills the `KbChunk` mirror and can
re-embed a whole corpus after an embedding-model change. `__specs/41` records
that changing `EMBEDDING_MODEL` **requires a full reindex** because mixed vector
spaces return nonsense.

**What the numbers say.**

| | Value | Source |
| --- | --- | --- |
| Largest real KB on this instance | 7 sources, **8 chunks** | `knowledgesources`, `kbchunks` |
| Measured embedding cost | **$0.0000201 per 1k tokens** | $0.00048284 over 24,142 tokens, 1,453 rows |
| Derived cost, 25MB document | ~26,162 chunks, ~7.8M tokens, **~$0.16** | measured chunk counts, §1 of `__specs/38` |
| Derived cost, 100k-chunk corpus | ~30M tokens, **~$0.60** | same rate |

**The "largest real KB" is 8 chunks.** There is no large corpus on this instance,
so the honest answer to "measured duration and USD for the largest real KB" is:
too small to measure. The rate is solid (1,453 samples); the corpus is not there.

**Resumability survives more than a checkpoint file would.** `reembed.ts:21`:
resumability is *by observed state*, not a checkpoint — `--resume` skips sources
already mirrored. That survives a crash, a kill and a redeploy, because the state
it reads is the outcome, not a note about the outcome.

**What a customer sees while it runs.** Re-embedding writes new vectors under the
same ids, so retrieval keeps working against the old vectors until each source is
replaced. The visible risk is not downtime but **a window of mixed vector spaces**
if the model changed: sources already re-embedded and sources not yet re-embedded
are in different spaces, and similarity between them is meaningless.

**Recommendation.** Two different shapes for two different jobs:

- **Mirror backfill only** (no model change): no window needed. Same vector
  space, resumable, run it live.
- **Embedding-model change**: needs a window, because of the mixed-space problem
  above. Shape it per-agent rather than per-platform: drain one agent, re-embed
  it, restore it. Agents are independent knowledge bases, so a rolling
  per-agent migration keeps every other tenant fully live.

**Who absorbs the cost:** at $0.0000201 per 1k tokens, a full re-embed of a
100k-chunk corpus is under a dollar. This is not a cost worth billing to a
customer or gating on approval; absorb it.

---

## 3. Rerank provider

**The default.** `KB_RERANK_ENABLED=false`, and when enabled
`KB_RERANK_PROVIDER=pinecone` with `bge-reranker-v2-m3`. The alternative is
`llm`, which reuses `AI_QUERY_REWRITE_MODEL` (`rerank.ts:132-138`).

**What the numbers say.** Both providers are reachable in principle
(`PINECONE_API_KEY` and `OPENROUTER_API_KEY` are both present), but **no
comparison exists**:

| Metric requested | Pinecone | LLM | Status |
| --- | --- | --- | --- |
| Precision@5 | — | — | never measured |
| Faithfulness | — | — | never measured for either (see §1) |
| p95 latency | — | — | never measured |
| USD per turn | — | — | never measured |

What *is* recorded: `KB_RERANK_MIN_SCORE = 0.0005` was chosen by a measured sweep
over the eval set (`__specs/42`: 0.02 → 0.422 no-evidence rate, 0.0005 → 0.200
against an ideal of 0.178). That sweep tells you the floor is calibrated for
`bge-reranker-v2-m3` specifically, and **not** that reranking beats no reranking.

**The exact experiment.** Three retrieval-only harness runs on the same fixture
set, which spends embedding tokens but no judge or answering tokens:

```bash
KB_RERANK_ENABLED=false pnpm eval:rag --retrieval-only
KB_RERANK_ENABLED=true KB_RERANK_PROVIDER=pinecone pnpm eval:rag --retrieval-only
KB_RERANK_ENABLED=true KB_RERANK_PROVIDER=llm     pnpm eval:rag --retrieval-only
```

Compare Precision@5, MRR and the rerank `latencyMs` and `rankCorrection` fields
already recorded per turn. `rankCorrection` is the decisive one: a reranker that
never changes the top result is latency and money for nothing.

**Recommendation.** Keep `pinecone` as the default *when reranking is turned on*:
it is a hosted cross-encoder, an order of magnitude cheaper per call than asking
an LLM the same question, and it returns a calibrated score rather than a number
a language model invented. But **run the three-way comparison before enabling
reranking at all** — the decision that matters is not which provider, it is
whether the feature earns its latency, and nothing in this repository answers
that yet.

**Blocked here:** the harness needs embedding spend and the account balance is
exhausted.

---

## 4. Every recorded "proceeded under assumption"

Reconstructed per §0. Grouped by where the assumption still lives.

### Still true and still load-bearing

| # | Assumption | Where it is recorded | Status |
| --- | --- | --- | --- |
| A1 | Telemetry retention is 90 days, configurable, matching `ToolCallLog` | `__specs/12` §6.8, `RagTurnMetric.ts` | Holds |
| A2 | Telemetry query text is masked **unconditionally**, not gated on the org's `piiRedaction` setting | `__specs/12` §6.9 | Holds |
| A3 | Retrieval-confidence weights (0.60/0.25/0.15) are **tuned, not measured** | `__specs/39`, `retrieval-confidence.ts` | Holds. Nothing routes on the number, so the cost of being wrong is low |
| A4 | A turn's **first** KB search is the one recorded on the metric | `rag-telemetry.service.ts` `queriesOf` | Holds |
| A5 | Per-source mean score is exact only for rank-1 turns, because P9 stores one `topScore` per turn | `__specs/03` §14b, `__specs/39` | Holds. Fixing it means adding `sourceScores` to the telemetry write |
| A6 | `RAG_EVAL_REPORTS_DIR` defaults to a monorepo-relative path; an API-only image answers `available: false` | `__specs/13`, `rag-metrics.routes.ts` | Holds |
| A7 | The knowledge-gap join runs in Node, not `$lookup`, because one side is PII-masked and the other is not | `__specs/07` RAG Metrics | Holds |
| A8 | Weak chunks are surfaced by notification plus live dashboard, **not** persisted as findings | `__specs/04` "Index health" | Holds |
| A9 | Drift is defined as "stored text does not hash to the stored `contentHash`" — the only drift detectable without re-fetching the original | `index-health.job.ts` | Holds |
| A10 | `stale` is a **new field**, not a reuse of `priority`: "out of date" and "we stand behind this less" are different judgements | `KnowledgeSource.ts` | Holds |
| A11 | Drift scan examines 5,000 sources per night, newest first; bounds work, not memory | `index-health.job.ts` `MAX_DRIFT_SCAN` | Holds |
| A12 | `KB_HYBRID_ALPHA = 0.7` is **measured**, from a sweep (Recall@5 1.000 / MRR 0.912 vs 0.973 / 0.856 dense-only) | `__specs/41` | Holds |
| A13 | `KB_RERANK_MIN_SCORE = 0.0005` is **measured**, from a sweep | `__specs/42` | Holds |
| A14 | `KB_HEALTH_GAP_SIMILARITY = 0.55` is measured but on **7 queries from one corpus** — a starting point, not a tuned optimum | `__specs/04` | Holds, weakly. Re-measure on real gaps |
| A15 | Judge output capped at 4,000 tokens; conflict check at 512 — because OpenRouter reserves `max_tokens` against the balance before the call | `__specs/05`, `judge.ts`, `conflict.ts` | Holds |

### Superseded or resolved since

| # | Assumption | What changed |
| --- | --- | --- |
| A16 | P9 stored source-level retrieval only | **Superseded.** P11 added `retrieval.chunks`; per-chunk scoring needed it and citation-proxying could not express `retrieved_not_cited` |
| A17 | Spec claimed per-org Pinecone namespaces as a 🔴 Critical control | **Corrected.** Never implemented; `__specs/12` §1.3 now describes metadata filtering, with namespaces recorded as future hardening in `__specs/04` |
| A18 | `pnpm audit` gating deferred until the backlog is triaged | **Still deferred**, now with a reason written into `ci.yml`. 63 vulnerabilities, 3 critical |
| A19 | No backfill for historical fake-zero costs | **Holds**, and the population is now known: 2 of 1,516 usage rows |

### Discovered during this audit, not previously recorded

| # | Finding | Where | Status |
| --- | --- | --- | --- |
| A20 | **The P6 uncited-ratio control is not a control.** `finalize.node.ts` lowers confidence, but nothing routes on confidence: the only consumer of `AI_CONFIDENCE_THRESHOLD` is the telemetry flag. It is a signal, not a control | `E2E_FLOW.md` §4, `__specs/37` generation stage | **Comment fixed, decision still open.** The comments in `finalize.node.ts` and `config/env.ts` that claimed an escalation exists have been corrected to describe the actual behaviour. Whether low confidence *should* route to a human is a product change and is deliberately not made: it needs a false-positive rate measured against real traffic first, which needs the faithfulness sampling in risk 2 of `__specs/37` to have run |
| A21 | No reasoning trace exists in graph state, and no document justifies its absence | `__specs/05` "ReAct conformance" §4a | Open |
| A22 | Four scheduled loops have **no overlap guard** | `__specs/38` S1, S2 | **FIXED.** `jobs/serial-loop.ts` drops a tick whose predecessor is still running, for all four loops. `serial-loop.test.ts` |

---

## 5. What could not be determined

| Question | Why | What would settle it |
| --- | --- | --- |
| Faithfulness of this system, offline or online | Never measured; 48/48 reports null | One 45-case run with the judge funded |
| USD per judge call | The one run that called the judge recorded a null cost | Same run, with cost settling working |
| Cheaper-judge agreement | Needs two judges over the same cases; neither has run | Two runs, same fixture set |
| Rerank provider comparison | Neither provider has been benchmarked | The three commands in §3 |
| Reindex duration for a large KB | The largest KB here is 8 chunks | Run `reembed.ts` against a real corpus |
| `topK` vs corpus size | No large corpus, no seeding script | Test T1 in `__specs/38` §4 |
| Concurrent turn ceiling | Every turn spends answering tokens; balance exhausted | Test T2 in `__specs/38` §4 |
| Production latency distribution | 4 telemetry rows; the p95 is not a p95 | Accumulate real traffic |
| The original P1-P8 assumption text | Changelogs unrecoverable (§0) | Nothing. Reconstruct forward, and commit from now on |
