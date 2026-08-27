# 39 — RAG Evaluation

## Overview

`packages/rag-eval` (`@csb/rag-eval`) scores retrieval and generation quality
offline, so a change to the RAG pipeline can be defended with a number instead of
an impression. It is the foundation every later retrieval change is measured
against, and it deliberately depends on none of them.

Run it with `pnpm eval:rag`. It writes a JSON report to
`packages/rag-eval/reports/<timestamp>.json` and prints a table.

## The one rule

**The harness measures production or it measures nothing.** Retrieval goes
through `understoodSearch` — the production retrieval path since query
understanding shipped, which rewrites, expands, fuses and optionally runs one
follow-up round before `searchKb` ever sees a string. Generation goes through
`generateAiReply` driving the real LangGraph agent.

Calling `searchKb` directly, as this harness did when first written, measures a
path no customer takes and reports exactly zero of the effect a rewriting change
has — which is the one thing the retrieval metrics exist to detect. There is no retrieval logic, no prompt construction and no model
client anywhere in the package. `src/__tests__/measures-production.test.ts`
enforces this mechanically: it fails if any module imports a vector store, embeds
a query itself, builds an answering prompt, drives the graph directly, or
constructs its own LangChain client.

The failure this prevents is gradual and silent. Someone hits an awkward
dependency, calls Pinecone directly "just for the eval", and from that moment the
numbers describe a pipeline no customer touches. The graphs keep moving and mean
nothing.

## Fixture workspace

Everything runs against a dedicated organization (`rag-eval-fixture`), agent and
knowledge base, seeded by `src/fixtures.ts` from the markdown in
`fixtures/kb/`. Retrieval is scoped by `(organizationId, agentId)` exactly as
production scopes it, so an eval run cannot read a real tenant's knowledge.

Documents are ingested through the real `ingestSource` pipeline: chunk, embed,
upsert to Pinecone. Seeding vectors by hand would measure a pipeline that does
not exist. Seeding is idempotent and re-ingests a document only when its content
hash changes, so embedding tokens are spent once rather than once per run. A
zero-chunk ingest is treated as a hard failure, because it reports success while
retrieving nothing and would turn every case against that document into a false
negative.

## Dataset

`fixtures/golden.json`, validated by the zod schema in `src/types.ts`.

```jsonc
{
  "id": "fact-team-price",
  "question": "How much is the Team plan per month?",
  "expectedSourceIds": ["billing"],   // fixture document slugs, not ObjectIds
  "expectedChunkIds": [],
  "referenceAnswer": "The Team plan is $99 per month.",
  "mustContain": ["99"],
  "mustNotContain": [],
  "tags": ["fact"],
  "history": []                        // prior turns, for follow-up cases
}
```

Cases name documents by **slug**, resolved to real `KnowledgeSource` ids at run
time. Ids change every reseed, and chunk indices move whenever the chunker
changes; a case that says "the answer is in refunds.md" survives both. An
unresolvable slug is a hard error rather than a silent skip, because it would
otherwise turn a positive case into a negative one and quietly inflate the
refusal rate.

A case with **no** expected evidence is a negative case: the KB genuinely does
not contain the answer, and the correct behaviour is to say so and escalate.

### Case types

The seed set is 45 cases across six types, all required by the dataset test:

| Tag | What it exercises |
| --- | --- |
| `fact` | Direct lookup of a single stated fact |
| `multi-hop` | An answer that needs two documents combined |
| `paraphrase` | The customer's wording differs from the document's |
| `typo` | Misspelled queries, which embed poorly |
| `follow-up` | Only meaningful with conversation history |
| `negative` | The KB genuinely lacks the answer |

### Negative cases are verified, not asserted

`src/__tests__/dataset.test.ts` holds a probe list per negative case and fails if
the fixture KB mentions any of its subject terms. A "negative" case whose answer
is actually in the KB measures a dataset bug, not refusal correctness, and
rewards the model for refusing something it should have answered.

Probes match on **word boundaries**, not substrings: a plain `includes` reports
`sla` as present because the KB mentions Slack, which fails a good case and
teaches whoever hits it to weaken the probe instead of trusting it.

### Adding cases

1. Add the case to `fixtures/golden.json` with a unique id and the right tag.
2. If it is negative, add a probe list to `NEGATIVE_PROBES` in the dataset test.
   The test fails if a negative case has no probe, so this cannot be forgotten.
3. Run `pnpm --filter @csb/rag-eval test`.

### Generating cases from production logs

Cases can be mined from real conversations. The path is deliberately manual,
because an auto-generated golden set encodes today's behaviour as correct:

1. Export conversations with their `Message.sources` (the cited sources become
   the `expectedSourceIds` candidate).
2. Mask PII with `apps/api/src/services/integrations/piiMask.ts` before anything
   is written to a fixture file.
3. Have a human write `referenceAnswer` from the source documents, **not** from
   what the bot said. Copying the bot's answer makes the case unfalsifiable.
4. Map the cited source to a fixture document, or add the underlying content to
   `fixtures/kb/` so the case is answerable offline.

## Metrics

### Retrieval

Scored at **source granularity** against `expectedSourceIds`, with the ranked
list deduplicated to first appearance per source so one document occupying three
of five slots does not count three times.

| Metric | Definition | Why it is separate |
| --- | --- | --- |
| Recall@K | Fraction of the relevant set found in the top K | Graded, not a hit flag: a multi-hop case that finds one of two sources scores 0.5 |
| Precision@K | Relevant results in the top K, **divided by K** | Measures context budget spent usefully. 2 returned and both relevant at K=5 is 0.4, not 1.0 |
| MRR | 1 / rank of the first relevant result | Ignores everything past the first hit; catches "found it, but at rank 8" |
| nDCG@K | Position-discounted gain over the ideal ranking, ideal capped at K | Capping matters: 3 relevant at K=2 would otherwise score 0.79 for a perfect result |

Reported at K = 3, 5, 10 in one run, alongside the hit rate at the production
`AI_KB_SEARCH_TOP_K` and the widen-on-empty rate.

**Null is not zero.** A metric that does not apply to a case (recall on a
negative case) is null and excluded from the mean. Averaging nulls as zero is
the easiest way to make a retrieval change look worse than it is.

### Generation

LLM-as-judge, pinned by `RAG_EVAL_JUDGE_MODEL`, built through `createChatModel`
and never a fresh client (that factory exists because the umbrella `ChatOpenAI`
class 404s on newer OpenRouter model ids). The judge sees only the question, the
retrieved passages, the reference answer and the answer under test. It never
sees the knowledge base.

| Metric | Definition |
| --- | --- |
| Faithfulness | Supported claims / total claims, after decomposing the answer into atomic claims. **The hallucination metric.** Every unsupported claim is listed in the report |
| Answer relevance | Does the answer address the question asked |
| Correctness | Does it agree with `referenceAnswer` in substance |
| Context precision | Passages actually needed / passages sent |
| Context recall | Facts the reference needs that were present in the passages |
| Citation accuracy | Citations pointing at a passage that supports their sentence |
| Refusal correctness | On negative cases only: declined **and** escalated |

Three deliberate nulls:

- **Faithfulness of an answer with no claims is null, not 1.0.** A correct
  refusal asserts nothing, so it cannot be unfaithful; scoring it 1.0 would let a
  bot that refuses everything top the table.
- **Citation accuracy with no citations is null, not 0.** Until grounded
  prompting ships most replies cite nothing, and 0 would read as catastrophic
  failure of a feature that does not exist.
- **Refusal correctness requires declining *and* escalating.** "I'm not sure",
  with the customer left sitting there, is not a handled case.

### Operational

Latency split by retrieval and generation, token counts, and USD cost.

**Cost is the trap.** There is no local price table. `recordConversationUsage`
fires and forgets, then asks OpenRouter's `/generation?id=` endpoint, which 404s
until the record lands; when `fetchGeneration` gives up it returns null and
`recordUsage` writes the row **anyway, with zeros**. A naive read reports 0.00
for calls that cost money.

So the harness settles costs in a pass after the run and distinguishes the two:
a row naming generations but reporting zero tokens is a give-up and is marked
**unknown**; a row with tokens is trusted even if its cost rounds to zero.
Unresolved cases are excluded from the total and counted separately. The report
prints `unknown`, never `$0.00`. A fake zero in a budget table is worse than a
blank, because it is indistinguishable from a free call.

Costs are joined back to cases by conversation id, not array position: one
errored case would otherwise shift every later index and attribute one case's
cost to another.

## Running

```bash
pnpm eval:rag                                  # full golden set
pnpm eval:rag --tag multi-hop                  # one slice
pnpm eval:rag --limit 10                       # the CI smoke subset
pnpm eval:rag --k 3,5,10                       # which K values to report
pnpm eval:rag --no-judge                       # skip the judge, still answers
pnpm eval:rag --retrieval-only                 # skip the answering model entirely
pnpm eval:rag --reingest                       # force fixture re-ingest
pnpm eval:rag --baseline reports/<file>.json   # fail on regression
pnpm eval:rag --baseline <f> --tolerance 0.05  # widen the gate
```

Exit codes: `0` clean, `1` a regression against the baseline, `2` the run itself
failed. CI needs to tell "quality dropped" apart from "the harness broke".

### Baseline comparison

`--baseline` compares every gated scalar and fails when one drops by more than
the tolerance (default 0.02). Two deliberate exclusions:

- A metric that was **null in the baseline** and has a value now is not a
  regression. It is a feature landing, and failing on it would break the first
  run after every improvement.
- **Widen-on-empty rate** is not gated. It is a diagnostic and rises legitimately
  when the dataset gains harder cases.

### Judge caching

Judge verdicts are cached on disk by (case id, answer hash, judge model, prompt
version), so rerunning an unchanged answer is free. Changing the judge model or
the prompt invalidates the cache rather than mixing verdicts from two different
judges into one number.

## Reading a report

The table is a summary; the JSON holds every case. Read it in this order:

1. **Errored count.** Anything above zero means the numbers describe a subset.
2. **Faithfulness, then the unsupported-claims list.** The list is the actionable
   part: it names the exact sentences the context did not support, split by
   `contradicted` (retrieval or grounding failure) versus `not_found`
   (invention). The fixes differ.
3. **Recall@K against Precision@K.** High recall with low precision means the
   evidence is being found and buried in noise. Low recall means it is not being
   found at all, and no amount of prompting fixes that.
4. **Context recall against Recall@K.** Low context recall with high Recall@K
   means passages were retrieved and then dropped before the prompt.
5. **Unresolved cost count.** A large number means the cost figure is a floor,
   not a total.

## Online telemetry

Everything above measures a fixed golden set. That set ages the moment an
operator uploads a document, and it never contained the question the customer
asked this morning. So the same metrics are also computed **live**, on every
production turn, into the `ragturnmetrics` collection
([`03-data-model.md`](03-data-model.md)).

Offline answers "did this change help". Online answers "is it working right now,
for this org, on this knowledge base". Neither substitutes for the other, and
they deliberately share a judge so their faithfulness numbers are comparable.

### The constraint

**Nothing here may cost a customer a millisecond, and nothing here may fail a
reply.** The runner calls `recordRagTurn` after the reply is persisted and
emitted, and does not await it. The write is one document. The judge, when a turn
is sampled, runs after that. Every path is wrapped so a failure becomes a log
line.

This is tested rather than asserted: `rag-telemetry.test.ts` throws inside the
telemetry write on purpose and compares the persisted reply byte for byte
against a healthy run, and it times a turn with a deliberately slow judge to show
the judge finishes only after the reply has already returned.

### What is captured, and where

| Stage | Captured in | Why there |
| --- | --- | --- |
| Retrieval | `KnowledgeBaseRetriever.searchHits()` | Two fields exist nowhere else: `widenedOnEmpty` is a decision made inside that method and leaves no trace in the hits it returns, and `minScore` is the floor *actually* applied, not the configured one |
| Generation | `nodes/finalize.node.ts` | It already produces `confidence`, `action` and the validated citations; `latencyMs` cannot be recovered afterwards at all |
| The record | `graph/runner.ts` | After the turn is persisted, so `messageId` exists and the reply is already on its way out |

Retrieval stats ride the graph state as `retrievalStats`, parallel to `kbHits`
rather than folded into it, because they answer different questions: `kbHits` is
what survived to the prompt, `retrievalStats` is what every search actually did —
including the searches that returned nothing, which leave no hits behind and are
exactly the turns worth monitoring.

### Retrieval confidence

A raw cosine score cannot say whether retrieval found the answer. It is not
comparable across queries — 0.42 is an excellent match for one question and noise
for the next — which is the same property that makes a fixed
`AI_KB_SEARCH_MIN_SCORE` always either too tight or too loose
([`42-reranking.md`](42-reranking.md)).

`retrievalConfidence` is a normalised `[0,1]` number combining three signals that
fail in different ways:

```
scores sorted descending: s₀ ≥ s₁ ≥ … ≥ sₙ

magnitude = clamp01(s₀)                        weight 0.60
margin    = clamp01((s₀ − s₁) / s₀)            weight 0.25   (1 when n = 0)
depth     = min(count, 3) / 3                  weight 0.15

retrievalConfidence = clamp01(0.60·magnitude + 0.25·margin + 0.15·depth)
```

- **magnitude** — how good the best passage looks in absolute terms.
- **margin** — how far clear of the runner-up it is, *relative to itself*, which
  makes it scale-free: a decisive win reads the same whether the scores are
  0.9/0.2 or 0.09/0.02. This is what carries the signal when magnitudes are
  compressed.
- **depth** — whether anything corroborates it, saturating fast. The third
  passage is worth far less than the second and the tenth nothing.

The weights are a convex combination, so the output is in `[0,1]` by
construction and each term is directly readable as "how much of the confidence
came from where". They are tuned, not measured: this is a monitoring signal.

Scores are **sorted here**, not taken in list order. After RRF the list is
ordered by fused rank and its raw scores are not monotonic.

**The two boundary cases are decided, not incidental:**

- **Zero hits → exactly 0**, short-circuited before the formula. Retrieval found
  nothing, so there is no evidence to be confident about. Letting depth and
  margin contribute a floor would make "found nothing" score above "found one
  weak passage".
- **One hit → full margin, one-third depth.** There is no runner-up, and both
  alternatives are wrong: scoring the margin 0 punishes a single decisive source
  (the common shape of a good answer in a small knowledge base), while scoring
  depth full would let one weak passage read as a corroborated answer. Full
  margin with one-third depth puts a strong lone hit high but below a
  corroborated one, and leaves a weak lone hit low, because magnitude carries 60
  percent of the weight.

**It replaces no threshold.** `AI_KB_SEARCH_MIN_SCORE`, `KB_RERANK_MIN_SCORE`
and `AI_CONFIDENCE_THRESHOLD` all behave exactly as before. This number is
emitted alongside the raw scores and nothing routes on it. Making it a control
before it has been watched in production would be shipping an untested
escalation policy.

### Sampled faithfulness

`RAG_FAITHFULNESS_SAMPLE_RATE` (default `0.05`) of turns are scored by the same
judge the offline harness uses. The judge now lives in
`apps/api/src/services/ai/eval/judge.ts` so both callers share one prompt and one
definition of faithfulness; `packages/rag-eval/src/judge.ts` keeps only the disk
cache, which is an offline concern (online has nothing to cache — every
production answer is new).

Five percent because this is a trend line, not an audit: at a few hundred turns a
day it moves a rolling average within a day, and it keeps the judge bill to a
rounding error against the answering model.

Three ways a drawn turn produces no score, each recorded as a distinct
`skippedReason` rather than collapsed into a null:

| Reason | Meaning |
| --- | --- |
| `no_passages` | Nothing was retrieved, so there is nothing to be faithful *to*. `flags.noHits` already tells that story; judging would produce a guaranteed 0 for a reason unrelated to grounding |
| `budget_exceeded` | The org is over its monthly AI budget (`orgBudgetStatus`, the same gate the rest of the AI surface uses). Its replies are paused; spending more of its money on measurement would be perverse |
| `no_claims` | The answer made no factual assertions. Not a failure — a correct refusal cannot be unfaithful, and scoring it 1.0 would let a bot that refuses everything top the table |
| `judge_error` | The judge call failed or timed out |

`sampled: true` with a null score is a different fact from "not sampled". A
dashboard must not average the two together.

### Alerts

An org is notified when, over `RAG_ALERT_WINDOW_MINUTES`, one of three rates
crosses its threshold. They alert separately because each has a different fix:

| Rate | Default | What it means | The fix |
| --- | --- | --- | --- |
| no-hit | `0.4` | The knowledge base is missing the topics being asked about | Write documents |
| low-confidence | `0.3` | Answers are produced but not trusted | Usually retrieval quality, not missing content: look for near-duplicate or stale documents competing with the right one |
| escalation | `0.5` | The bot is handing off | Could be either, and it is the one an operator feels in their own inbox first |

`RAG_ALERT_MIN_TURNS` (default 20) is the floor. Three turns of which one missed
is not a 33 percent no-hit rate, it is three turns.

Alerts go through the existing `notification.service.ts` path, and dedupe against
the notifications already written rather than a new bookkeeping collection — the
notification *is* the record that the alert fired. Evaluated by a sweep job every
`RAG_ALERT_INTERVAL_MS`, not per turn: the rates are computed over a window, so
running the aggregation after every turn would recompute nearly the same answer
hundreds of times an hour on the tail of the reply path.

### Dashboard metric definitions

The **RAG Quality** page ([`11-page-wiremap.md`](11-page-wiremap.md)) renders
every tile with a tooltip, and those tooltips are these definitions verbatim.
They are held in `apps/api/src/services/ai/eval/metric-definitions.ts` and served
from `GET /rag-metrics/definitions`, and
`apps/api/src/__tests__/rag-metrics.test.ts` parses the tables on this page and
fails if a single word drifts. Two definitions of Precision@5 in one product is a
bug, and the offline report and the live dashboard are one product.

#### Production proxies

Retrieval scoring offline uses `expectedSourceIds` — a human-declared relevant
set. Production has no such set, so the dashboard proxies it with **the sources
the reply actually cited**, and the ranked list is `retrieval.sourceIds`, already
deduplicated to first appearance per source. The metric definitions are
unchanged; only the relevant set is different, and that difference is stated in
every tooltip.

A turn that cited nothing cannot be scored and is excluded, not counted as zero.
The proxy is therefore blind to the failure where retrieval missed the answer
*and* the model cited a weak passage anyway — which is what
`flags.noHits` and online faithfulness are for.

| Metric | Definition | Note |
| --- | --- | --- |
| Production relevant set | The sources the reply cited, standing in for a human-declared relevant set | Only turns that cited at least one source are scored. A turn that cited nothing is excluded, never counted as zero |

#### Production-only metrics

Live counterparts with no offline equivalent. Rates are over turns in the
selected window.

| Metric | Definition | Note |
| --- | --- | --- |
| No-hit rate | Share of turns where retrieval returned no passage for the reply to be grounded in | The knowledge base is missing the topic. The fix is writing a document |
| Low-confidence rate | Share of turns whose confidence fell below `AI_CONFIDENCE_THRESHOLD` | Usually retrieval quality rather than missing content: look for near-duplicate or stale documents competing with the right one |
| Widen-on-empty rate | Share of turns where the score floor filtered everything out and retrieval retried with no floor | A high rate means `AI_KB_SEARCH_MIN_SCORE` is set above where this corpus actually scores |
| Escalation rate | Share of turns handed to a human | The assistant declining rather than guessing, which is correct behaviour but expensive at volume |
| Mean confidence | Average of the meta pass's confidence across turns, after any uncited-ratio penalty | Not a probability. It is one model's stated confidence in another model's answer, useful as a trend and not as an absolute |
| Retrieval confidence | Normalised 0-1 blend of the best passage's score, its margin over the runner-up, and how many passages corroborate it | Derived, not a raw score, because a cosine score is not comparable across queries. Nothing routes on it |
| Mean top score | Average raw similarity of the best passage retrieved | Always on the cosine scale, whichever of fusion and reranking ran |
| Citation rate | Share of replies carrying at least one citation | A reply with passages retrieved but nothing cited is grounded only by luck |
| Citations per answer | Mean number of validated citations on replies that cited anything | Markers pointing at nothing are stripped before this is counted |
| Helpfulness | Thumbs up as a share of all thumbs on replies in the window | The only metric here a customer produced. Sparse by nature; read it as a signal, not a rate |
| Cost per conversation | Total resolved USD in the window divided by the conversations that produced it | Turns whose cost OpenRouter never resolved are excluded from both halves, so this is a cost per *priced* conversation |
| End-to-end latency | Wall clock from the start of a turn to its persisted reply, p50 and p95 | Includes retrieval, every tool round trip and both finalize calls. It is not the time to first token, which is what the customer actually sees |
| Source retrieval count | Turns in which this source contributed at least one passage | |
| Source mean top score | Average top score across the turns where this source ranked **first** | Exact rather than approximate: the turn's top score belongs to the top-ranked source, so turns where this source placed lower are excluded rather than credited with another source's score |
| Never retrieved | Ready sources that no turn in the window retrieved | Dead weight in the index. Either the content is unreachable by the questions being asked, or nobody is asking about it |

### Retention and PII

`ragturnmetrics` carries a TTL index of `RAG_TELEMETRY_RETENTION_DAYS` (default
90), matching every other per-turn telemetry collection. Query text and the
judge's unsupported-claim strings pass through
`services/integrations/piiMask.ts` **before** persisting, unconditionally — the
org's `piiRedaction` setting governs what reaches the model, and this is an
analytics store an operator browses. See
[`12-security-compliance.md`](12-security-compliance.md) §6.8.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `RAG_EVAL_JUDGE_MODEL` | — | OpenRouter model id for the judge. Defaults to a strong Claude model. Must never be the answering model |
| `AI_QUERY_*` | — | Query-understanding flags. The harness reads them from the environment, so a before/after is `AI_QUERY_REWRITE_ENABLED=false pnpm eval:rag …` then `=true`. See [`40-query-understanding.md`](40-query-understanding.md) |
| `MONGODB_URI`, `PINECONE_API_KEY`, `PINECONE_INDEX`, `OPENROUTER_API_KEY`, `EMBEDDING_MODEL` | ✅ | The same variables the API needs; the harness runs production code |
| `RAG_TELEMETRY_ENABLED` | — | Online per-turn telemetry. Default on |
| `RAG_TELEMETRY_RETENTION_DAYS` | — | TTL on `ragturnmetrics`. Default 90 |
| `RAG_FAITHFULNESS_SAMPLE_RATE` | — | Share of production turns judged online. Default `0.05`; `0` disables sampling without disabling telemetry |
| `RAG_FAITHFULNESS_JUDGE_MODEL` | — | Online judge model. Defaults to `RAG_EVAL_JUDGE_MODEL` so the online and offline numbers stay comparable |
| `RAG_FAITHFULNESS_TIMEOUT_MS` | — | Ceiling on one out-of-band judge call. Default 20000 |
| `RAG_ALERT_*` | — | Rolling-window quality alerts. See [`13-env-variables.md`](13-env-variables.md) |

## CI

`rag-eval-smoke` runs the 10-case subset and posts the table to the run summary.
It is **advisory, never a merge gate**: it spends judge tokens and calls a
third-party model, so a provider outage or an empty credit balance must not block
a merge. It runs only when the retrieval or generation path changed, and is
skipped entirely without provider credentials so forks do not fail.

The full dataset is run deliberately before and after a retrieval change, not on
every push. See the RUNBOOK.
