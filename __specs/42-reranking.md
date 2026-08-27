# 42 — Cross-Encoder Reranking (Stage 2)

## Overview

Retrieval is now two stages: **high recall first, high precision second.**

Stage 1 (dense + lexical, fused — see [`41-hybrid-retrieval.md`](41-hybrid-retrieval.md))
casts wide and accepts noise. A bi-encoder scores the query and the passage
separately and compares two vectors, which is what makes it fast enough to run
over a whole index and also what limits it: it never sees the query and the
passage together.

Stage 2 does. A cross-encoder reads both at once and scores their actual
relevance. It is far more accurate and far too slow to run over an index —
running it over 50 candidates instead of 500,000 is the entire trick.

**It ships off by default.** The measurement is a genuine trade rather than a
clear win, and the numbers are below.

## Two settings, not one

`AI_KB_SEARCH_TOP_K` used to be both the candidate count and the final context
size, so widening the search also widened the prompt. They are now separate:

| Setting | Default | Meaning |
| --- | --- | --- |
| `KB_RERANK_CANDIDATES` | 50 | Stage 1's pool. Optimises recall |
| `AI_KB_SEARCH_TOP_K` | 8 | What reaches the prompt. Optimises precision |

With reranking off, stage 1 collapses to its previous width and nothing changed.

## Providers

Behind one `Reranker` interface in `retrieval/rerank.ts`.

**`pinecone`** (default) calls the hosted `bge-reranker-v2-m3` cross-encoder over
REST. Rerank is an account-level inference endpoint, not an index operation, so
it does not hang off `pc.index(...)`; the missing-key behaviour mirrors
`config/pinecone.ts` and degrades rather than throwing.

**`llm`** asks the small model from P3 for one score per passage. Strictly worse
on cost, latency and calibration, and it exists only so a deployment without a
reranker provider is not stuck with stage-1 ordering. It requests an integer per
passage rather than a free-form ranking, because a model asked to "sort these"
reliably drops or duplicates entries.

## The calibrated score, and what it unlocks

A cosine score is **not comparable across queries**: 0.42 may be an excellent
match for one question and noise for another. That is why a fixed
`AI_KB_SEARCH_MIN_SCORE` is always either too tight or too loose, and why
`widenOnEmpty` existed — when the floor filtered everything, the retriever
re-queried with no floor and handed the model whatever came back.

A cross-encoder score **is** comparable, because it answers one question ("does
this passage answer this query") on a consistent scale. That makes an honest
"the knowledge base does not contain this" expressible for the first time.

So `widenOnEmpty` is now gated on reranking being off. With a calibrated score
downstream, pushing a zero-relevance passage into the prompt stops being a
sensible hedge and becomes a hallucination risk: the model is handed text that
looks like evidence and is not.

### The floor gates on the best score, not on each passage

This distinction is the whole design, and getting it wrong cost multi-hop
retrieval half its recall before it was caught.

`bge-reranker-v2-m3` is **decisive rather than graded**. Measured directly
against the fixture corpus for "How much is the Team plan per month?":

```
0.574335  billing:0    <-- contains the answer
0.001134  onboarding:0
0.000789  refunds:0
0.000231  billing:1
0.000082  security:0
0.000038  api:0
```

It gives the answering passage ~0.5 and everything else below 1e-3 — **including
a passage that is genuinely required to answer a multi-hop question but does not
answer it alone.** Filtering per passage therefore throws away the second half of
every two-source answer. Measured: multi-hop Recall@5 fell from 1.000 to 0.583.

What the score reliably indicates is whether the KB contains an answer **at
all**, which is a property of the best candidate. So: if nothing clears the
floor, there is no evidence and we say so. If something does, the reranker's
*ordering* is trusted and the top K are kept regardless of their individual
scores. That restored multi-hop Recall@5 to 1.000 and raised its Precision@5
from 0.227 to 0.367.

### The floor value is swept, not guessed

Because the signal is the gap and not the magnitude, an intuitive floor is
badly wrong. `0.02` was the first guess:

| floor | "no evidence" rate | Recall@5 | MRR |
| --- | --- | --- | --- |
| 0.02 | 0.422 | 0.703 | 0.689 |
| 0.005 | 0.333 | 0.784 | 0.770 |
| 0.001 | 0.222 | 0.892 | 0.865 |
| **0.0005** | **0.200** | **0.919** | **0.892** |

The ideal "no evidence" rate is **0.178** — the 8 genuine negatives out of 45
cases. 0.0005 is the closest without collapsing recall, and is the default.

## No relevant evidence → escalation

When stage 2 reports no evidence, the `search_kb` tool:

1. Writes a `KnowledgeGap` record with the original query and the top rerank
   score, so an operator triaging a gap can see whether it missed by a little or
   by a mile.
2. Returns an explicit instruction rather than an empty result: *"The knowledge
   base does not contain an answer to this question. Say so plainly and escalate
   to a human. Do not answer from general knowledge."*

Told plainly, the model escalates instead of assembling an answer from what it
already believes. An empty result alone is ambiguous — it could equally mean
retrieval failed or the KB is empty.

## Degradation

Reranking is one external call on the hot path of every KB search, so failure
behaviour decides whether it is an improvement or a liability.

| Failure | Behaviour |
| --- | --- |
| Provider error | Stage-1 ordering, logged |
| Timeout past `KB_RERANK_TIMEOUT_MS` | Stage-1 ordering, logged |
| No provider configured | Stage-1 ordering |
| One candidate | Skipped entirely — cannot reorder, can only cost money |

Stage-1 ordering is exactly the retrieval quality that existed before reranking,
so a reranker outage costs precision, not availability. Every path is asserted.

## Measurement

Eval harness over the 45-case fixture set, `--retrieval-only`, alpha 0.7.

### The aggregate hides both the win and the loss

| | rerank off | rerank on (floor 0.0005) |
| --- | --- | --- |
| Recall@5 | **1.000** | 0.919 |
| MRR | **0.912** | 0.892 |
| "no evidence" rate | 0.000 | 0.200 |

Read alone, that says reranking is a regression. Split by case type it says
something quite different:

| Case type | rerank off | rerank on |
| --- | --- | --- |
| **fact** (15) | Recall@5 1.000 | 1.000 — unchanged |
| **multi-hop** (6) | Recall@5 1.000 | 1.000, Precision@5 0.227 → **0.367** |
| **negative** (8) | retrieves noise **100%** of the time | returns no evidence **100%** of the time |

Negatives are the point. Without reranking, every unanswerable question retrieves
something irrelevant and the model has to resist answering from it. With
reranking, all eight correctly return no evidence and route to escalation.

Recall cannot show this: a negative case has no relevant set, so its Recall is
null and excluded from the mean. The metric that would capture it — refusal
correctness — needs the LLM judge, which is unmeasured here (see below).

### Cost and latency

| | Measured |
| --- | --- |
| Rerank call, 50 candidates | **p50 1155ms, p95 1295ms** (8 calls) |
| Usage | **1 rerank unit per turn** |

USD per turn depends on Pinecone's inference pricing for rerank units, which is
not asserted here because it was not verified against an invoice.

### The verdict, plainly

**At the default candidate count the trade is not obviously worth it, so it
ships off.** Reranking adds ~1.2s and one external dependency to every KB search,
costs ~8 points of Recall@5 on answerable questions, and in exchange makes
unanswerable questions detectable for the first time.

Whether that is a good trade depends on something not measured here: whether a
confident wrong answer is worse for your customers than an occasionally missed
source. For a support bot it usually is, which is a real argument for turning
this on — but it is an argument, not a measurement, and the measurement that
would settle it (refusal correctness and faithfulness, both of which need the
judge) is blocked on eval budget.

## Telemetry

Every search carries stage 2's outcome on graph state:

```ts
rerank: { ran, provider, candidates, topScore, rankCorrection,
          noRelevantEvidence, latencyMs }
```

`rankCorrection` — whether the reranker's top result differed from stage 1's — is
the number that says whether reranking earns its cost. A reranker that never
changes the top result is latency and money for nothing.
