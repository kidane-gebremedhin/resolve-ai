# 40 — Query Understanding

## Overview

A vector search embeds a string. Until this shipped, that string was whatever
the model passed to the `search_kb` tool, embedded verbatim. That fails in four
predictable ways:

- **Follow-ups carry no subject.** "What about the annual one?" embeds near
  nothing, because the thing being asked about is in the previous turn.
- **Typos embed near nothing.** "waht is yuor refudn policy" is not close to
  "refund policy" in embedding space.
- **Multi-part questions embed near the midpoint** of two topics and match
  neither well.
- **Customers and documents use different words.** "Can I get my money back"
  versus "Refund Policy".

`apps/api/src/services/ai/retrieval/query-rewrite.ts` sits in front of every KB
search and fixes all four. It is **off by default**; see Measurement.

## Where it sits

In the `search_kb` tool, not inside `KnowledgeBaseRetriever`. The rewriter needs
conversation history and the org's vocabulary, which the retriever has no
business knowing about: its job is the tenancy guarantee and one Pinecone query.

```
search_kb tool
  └─ understoodSearch()
       ├─ rewriteQuery()            one small-model call
       ├─ retriever.searchHits()    once per planned query, in parallel
       ├─ reciprocalRankFusion()    when there is more than one list
       └─ proposeFollowUpQuery()    at most one extra round, flagged off
```

With every flag off this is one `searchHits` call with the model's own query,
byte-identical to the behaviour before the feature existed.

## What the rewrite does

One model call returns a JSON plan:

| Field | Purpose |
| --- | --- |
| `standalone` | The query rewritten to stand alone: follow-up resolved, filler stripped, typos fixed, acronyms expanded |
| `subQueries` | One per **independent** part of a multi-part question |
| `paraphrases` | Alternative phrasings, for vocabulary mismatch |
| `reason` | What changed, for the log line |

Two rules in the prompt matter more than the rest:

- **Product names, error codes, order ids and numbers are preserved exactly.**
  They are usually the highest-signal tokens in a query, and "correcting" them is
  the one way a rewrite can make retrieval strictly worse.
- **A single-part question returns an empty `subQueries`.** Models like to echo
  the standalone query back as a lone sub-query; retrieving it twice doubles the
  cost and changes nothing, so that case is dropped in code rather than trusted
  to the prompt.

### Vocabulary

The rewriter is given the agent's name and its KB document titles. Titles are
the cheapest available source of product names and acronyms, and they are the
exact spellings the documents use — which is the spelling that will embed
closest to the passage.

## Fusion: why RRF and not scores

When several strings are retrieved for one question the lists must be merged.
Merging on **score** does not work: cosine scores are not comparable across
different query embeddings, so whichever query happened to produce larger
absolute numbers would dominate regardless of whether its results were better.

Reciprocal Rank Fusion ignores scores and fuses on **rank**, which is comparable
by construction:

```
score(passage) = Σ over lists  1 / (k + rank)      k = 60
```

A passage ranked second by two queries (2 × 1/62 = 0.032) beats one ranked first
by a single query (1/61 = 0.016). That agreement signal is the entire reason to
retrieve a question more than one way.

`k = 60` is the constant from the original paper; it flattens the top ranks so
one query's favourite cannot outrank a passage two queries agreed on.

Deduplication is by chunk id, keeping the **highest raw score** seen for the
passage, because the citation panel and the knowledge-gap threshold both read
that score and neither should ever see a fused one. Ties break deterministically
so an unchanged corpus produces an unchanged ranking and an eval diff means
something.

Single-query retrieval skips fusion entirely rather than passing through RRF,
which would replace a meaningful cosine ordering with a rank-derived one for no
benefit.

## The one follow-up round

Some questions cannot be retrieved in a single pass. "Is the plan my account is
on covered by the EU refund policy?" needs a second query whose subject only
exists after the first round returns.

After the merged results come back, the same small model is asked one question:
is anything still unanswered, and if so what single query would answer it. If it
names one, exactly one more retrieval runs and the results are re-fused.

**Hard bounds, all enforced in code and asserted by tests:**

- At most **one** extra round, ever. There is no loop.
- No planner node, no new graph nodes, no separate sufficiency model.
- A follow-up identical to a query already run is discarded.
- Behind `AI_QUERY_FOLLOWUP_ROUND_ENABLED`, default off.

This is the bounded version of "let the agent plan what to retrieve and in what
order". An unbounded planner is the most expensive thing that can be added to a
per-turn path, which is why the bound is structural rather than a limit constant
someone can raise.

## Degradation

Rewriting is an **enhancement, never a dependency**. Retrieval that needs a
second model call is retrieval that breaks twice as often, so every failure path
returns the raw query and the turn proceeds:

| Failure | Behaviour |
| --- | --- |
| Timeout past `AI_QUERY_REWRITE_TIMEOUT_MS` | Raw query |
| Malformed / non-JSON response | Raw query |
| Valid JSON with no `standalone` | Raw query (checked explicitly; it would otherwise embed an empty string) |
| Provider error (402, 429, 5xx) | Raw query |
| Flag off | Raw query, with no model call at all |

Each of these is a separate test.

## Caching

Rewrites are cached by `(conversationId, sha256(query))` with a **60 second**
TTL. The agent can call `search_kb` more than once in a turn, sometimes with the
same query, and re-deriving an identical rewrite is a wasted call on the hot
path.

The TTL is short on purpose: a rewrite is resolved against conversation history,
and one computed three turns ago is exactly the staleness this feature exists to
prevent. The key includes the conversation id so one customer's resolved
follow-up can never be served to another's.

## Observability

Every search appends a `QueryRewriteRecord` to graph state (`queryRewrites`,
declared with the existing `appendReducer`, no second state mechanism):

```ts
{ originalQuery, rewrittenQuery, queriesRun[], rewritten,
  followUpRan, reason, rewriteLatencyMs, totalLatencyMs }
```

`rewriteLatencyMs` is the model call **alone**; `totalLatencyMs` includes the
retrievals it caused. They are separate because the latency budget is about the
rewrite, and folding retrieval in makes a fast rewrite look slow whenever
Pinecone is slow — a mistake made and corrected during this work.

The knowledge-gap record stores the **original** query, not the rewrite: an
operator reading the gap list wants to see what the customer actually asked.

## Measurement

Measured with the P2 harness (`pnpm eval:rag --retrieval-only --tag <tag>`) on
the fixture KB, rewriting off then on.

### Quality: a large, consistent win

| Subset | Recall@5 | | MRR | | nDCG@5 | |
| --- | --- | --- | --- | --- | --- | --- |
| | off | on | off | on | off | on |
| paraphrase (6) | 0.833 | **1.000** | 0.722 | **0.806** | 0.750 | **0.855** |
| typo (5) | 1.000 | 1.000 | 0.850 | **1.000** | 0.886 | **1.000** |
| follow-up (5) | 0.800 | **1.000** | 0.550 | **1.000** | 0.612 | **1.000** |

Follow-ups are the headline: MRR 0.55 to 1.00. That is the case the feature was
built for, and it is the one that was most broken.

Rewrite fallback rate was 0.000 across all three subsets: no failures.

### Latency: the budget is missed by 6x

| Subset | rewrite p50 | rewrite p95 |
| --- | --- | --- |
| paraphrase | 2918ms | 3223ms |
| typo | 2546ms | 3183ms |
| follow-up | 2324ms | 2488ms |

The specified budget was **400ms p95**. Three models were measured on the same
subset and all landed in the same band:

| Model | p50 | p95 |
| --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 2324ms | 2488ms |
| `google/gemini-2.5-flash-lite` | 2906ms | 3169ms |
| `openai/gpt-4o-mini` | 2585ms | 3275ms |

Model choice is not what makes this slow. The cost is a provider round-trip plus
generating a small JSON object, and no hosted model reaches 400ms for that.

**Therefore it ships off by default**, per the rule it was specified under.
Whether ~2.5s is worth a follow-up MRR of 1.00 instead of 0.55 is a product
decision about traffic and tolerance, not an engineering one, and the flag makes
it a config change either way.

### HyDE

| Subset | MRR off | MRR on | nDCG@5 off | nDCG@5 on |
| --- | --- | --- | --- | --- |
| paraphrase | 0.806 | **0.889** | 0.855 | **0.917** |
| typo | 1.000 | 1.000 | 1.000 | 1.000 |

It helps where there was headroom and does nothing where retrieval was already
perfect, at the cost of a second model call (+~800ms p95). Kept, behind its own
flag, default off, with these numbers attached so the flag is a decision rather
than dead weight.

## Testing

`apps/api/src/__tests__/query-rewrite.test.ts`, 25 tests. The model is injected,
so they run with no network and assert on real call counts.

The degradation tests matter most. Rewriting is on the hot path of every
customer turn, so the question is not "does it produce a good query" but "what
happens at 3am when the small model is timing out". If any failure path can
break a turn, the feature is a liability regardless of the recall it buys.
