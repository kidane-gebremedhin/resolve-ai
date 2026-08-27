# TODO, Enhanced and Converted to Agent Prompts

Source: `TODO.txt`. Every line there is expanded into a scoped, self-contained
prompt with explicit acceptance criteria, ordered so each one only depends on
what came before it.

**How to use:** copy one `>>>` block at a time into a coding agent. Each block is
standalone. Do not paste two at once, they touch overlapping files. The repo
rules that apply to every prompt live in `CLAUDE.md` and are not repeated here.

Every prompt opens with four lines that exist to stop an agent guessing:
*Depends on* (what must already be merged), *Ships behind* (the flag or config
that makes it reversible), *Blast radius* (what it touches), and *Budget* (what
it is allowed to cost, per turn or per run). Every prompt closes with a **DONE
WHEN** checklist. That checklist is the contract: each line is written to be
checkable by running something rather than by reading the diff and feeling good
about it. A prompt is finished when every line passes, not when the code looks
done.

---

## Map: TODO.txt line to prompt

| TODO.txt item | Prompt |
| --- | --- |
| "Update payment status and records on webhook events" | P1 |
| "Monitor faithfulness, truthfulness" + eval metrics | P2 |
| "don't send user queries directly, rewrite them first" | P3 |
| "for complex queries let the agent plan what to retrieve and in what order" | P3 |
| "combine keyword search with vector search" | P4 |
| "stop fixed size chunks, chunk on meaning/structure" | P4 |
| "fine-tune your retrieval based on domain" | P4 |
| "multi stage retrieval, wide recall then cross-encoder rerank" | P5 |
| "design prompt on retrieved context, enforce citations, answer only from context" | P6 |
| "compress retrieved context before sending to LLM" | P6 |
| "Behavior when having contradicting information in the kbs" | P7 |
| "Monitor document ingestion issues" | P8 |
| "Monitor retrieval and generation confidences" | P9 |
| "RAG METRICS dashboard" | P10 |
| "use query logs and user feedback to re-embed weak chunks" | P11 |
| "walk me through the production ready RAG pipeline, where quality breaks" | P12, part A |
| "Draw the full e2e flow diagram" | P12, part B |
| "Do we have the ReAct agent?" | P12, part C |
| "What could be broken on larger traffic, filesize, or kbs" | P12, part D |

---

# Phase 1, Ship what is missing

No dependencies, no measurement infrastructure required. Start here.

## P1. Payment status and records from webhook events

```
>>> PROMPT P1

Depends on: nothing. It is the only prompt here with no dependencies, and the
only one closing a gap a paying customer can feel today.
Ships behind: no flag. Webhook handlers are additive and must be idempotent.
Blast radius: the Paddle webhook path, a new collection, the billing UI. Real
money moves through this code, so idempotency and out-of-order handling are
correctness requirements, not polish.
Budget: no recurring cost. Webhook handling, one collection, one backfill run
once. If the backfill hits the Paddle API, page it and respect their rate
limit.

Track payment transactions, not just subscription state, so the app can show a
real payment status and a billing history.

Current state, verified:
- `apps/api/src/services/billing.service.ts` `handlePaddleEvent()` returns early
  on anything that does not start with `subscription.`. Every `transaction.*`
  event is silently dropped.
- There is no payment or invoice model. `apps/api/src/models/` has
  `Subscription`, `ExternalSubscription` and `ProcessedWebhook`, nothing per
  payment.
- `apps/web/src/app/(dashboard)/checkout/pending/page.tsx` already polls
  `/billing/subscription` every 4s and redirects on activation. That is the
  interim behavior the TODO refers to, keep it working.

Implement:
1. NEW MODEL `Payment`: organizationId, subscriptionId, provider (`paddle`),
   providerTransactionId (unique), providerInvoiceId, status (`pending` |
   `completed` | `failed` | `refunded` | `partially_refunded` | `disputed`),
   amount (integer minor units), currency, tax, discount, couponCode if any,
   billingPeriod { start, end }, paymentMethod { type, last4, brand },
   invoiceUrl / receiptUrl, failureReason, occurredAt, raw payload, timestamps.
   Index on (organizationId, occurredAt) and unique on providerTransactionId.
2. HANDLE `transaction.*` EVENTS. Extend the webhook handler (refactor the
   `subscription.`-only early return into a dispatch by event family) for:
   `transaction.completed`, `transaction.payment_failed`,
   `transaction.updated`, `transaction.billed`, `transaction.past_due`,
   and the refund and dispute events Paddle sends. Verify the exact event names
   and payload shapes against the current Paddle docs (use context7 or the
   Paddle API reference), do not guess field paths.
   Reuse the existing signature verification and the `ProcessedWebhook`
   idempotency guard, both already in `billing.service.ts`. Watch the guard's
   position when you refactor: today it sits immediately after the
   `subscription.` early return, so it runs once per accepted event and
   `transaction.*` events never reach it at all. After the refactor it must
   still run exactly once per event id, before any branch does work, and never
   twice in two branches. Getting this wrong on money code means a duplicate
   Paddle retry books a second payment row. Keep the handler idempotent, Paddle
   retries.
3. RECONCILE STATUS: a failed payment must mark the subscription past due and
   surface a dunning banner. A recovered payment must clear it. Mirror the
   existing pattern where subscription state is mirrored onto `Organization`
   for fast plan gates.
4. BACKFILL: a script that pulls historical transactions from the Paddle API for
   existing subscriptions so billing history is not empty on launch.
5. UI:
   - Billing history table on `apps/web/src/app/(dashboard)/app/billing/page.tsx`
     with date, description, amount, status badge, and a receipt link.
   - Payment status on the pending page: keep the poll, but also show the actual
     transaction status once a `Payment` row exists, so a failed payment shows
     as failed instead of spinning for 3 minutes. Keep the manual escape hatches.
   - A past-due banner with a link to update the payment method.
6. EMAILS: reuse `subscription-receipt.service.ts` for a payment-failed notice.
   Follow the existing fire-and-forget style so mail never blocks a webhook 200.

Tests: one test per event type using recorded fixture payloads, duplicate
delivery (must be a no-op), out-of-order delivery (a `completed` arriving after
an `updated`), refund handling, and a failed payment producing past-due state.

QA: use chrome-devtools MCP against Paddle sandbox where possible. A real card
charge needs a human, note it as blocked in `QA_TEST_RESULTS_<n>.md`.

Docs: `__specs/24-paddle-subscriptions.md`, `__specs/03-data-model.md`,
`__specs/07-api-specification.md`, RUNBOOK section on reconciling a stuck
payment.

DONE WHEN, all of these and not most:
- Every handled event type has a test using a recorded fixture payload, and the
  event names came from current Paddle docs rather than from memory.
- Duplicate delivery is a no-op. Asserted.
- Out-of-order delivery, a `completed` arriving after an `updated`, lands on the
  correct final state. Asserted.
- A failed payment marks the subscription past due and shows the banner;
  recovery clears both.
- The backfill ran, and billing history is not empty for existing subscriptions.
- Mail never blocks a webhook 200. Test it with a mailer that throws.
- Verified against Paddle sandbox with chrome-devtools MCP. A real card charge
  is a human step: mark it blocked in `QA_TEST_RESULTS_<n>.md` rather than
  quietly skipping it.
```

---

# Phase 2, Answer quality

P2 is the harness that scores everything after it, so it goes first: several of
these prompts ask you to pick a default from data, which is not possible
without it. The rest are ordered by what each one changes: rewriting changes
what is asked, hybrid changes the candidate pool, reranking depends on that
pool, grounded prompting shapes what the model finally sees. Every prompt here
reports its metric delta against P2, and a change that does not move a metric
does not ship.

## P2. Offline RAG evaluation harness

```
>>> PROMPT P2

Depends on: nothing. Everything in P3 through P7 is scored against it, so it
comes first.
Ships behind: no flag. It is a new package with no production code path.
Blast radius: new `packages/rag-eval/`, one CI step, `.env.example`. Zero
runtime change inside `apps/api`.
Budget: judge tokens are the only spend. Cache judge calls by (case id, answer
hash) so reruns are near free, keep the CI smoke subset at 10 cases or fewer,
and print USD per run so the number is known rather than assumed.

Build an offline evaluation harness for this RAG chatbot so retrieval and
generation quality can be scored on every change. This is the foundation for
every retrieval and generation change that follows it, so nothing here may
depend on any of them.

Location: new package `packages/rag-eval/` (pnpm workspace, matches the layout
in `__specs/02-monorepo-structure.md`). Name it `@csb/rag-eval`, matching the
`@csb/*` convention every other package here uses; `packages/*` is already in
`pnpm-workspace.yaml` so no glob change is needed. Expose it as `pnpm eval:rag`
from the root by adding a delegating script in the root `package.json` next to
the existing `db:migrate` one (`pnpm --filter @csb/rag-eval eval`). Do not add a
turbo task for it: `turbo.json` defines build, test, lint, type-check and clean
only, and an eval run is neither cacheable nor something CI should fan out.

1. GOLDEN DATASET
   - Define a JSON/YAML schema for a test case:
     `{ id, question, agentId, expectedSourceIds[], expectedChunkIds[],
        referenceAnswer, mustContain[], mustNotContain[], tags[] }`.
   - Ship a seed dataset of at least 40 cases against a fixture KB committed
     under `packages/rag-eval/fixtures/`, covering: direct fact lookup,
     multi-hop (answer needs two sources), negative cases (the KB genuinely
     does not contain the answer, the correct behavior is to say so and
     escalate), paraphrased and misspelled queries, and follow-up questions
     that only make sense with conversation history.
   - Add a documented path to generate more cases from real anonymized
     conversation logs.

2. RETRIEVAL METRICS, computed against `expectedChunkIds` / `expectedSourceIds`
   - Recall@K: is the required evidence anywhere in the top K.
   - Precision@K: fraction of the K retrieved passages that are relevant.
   - MRR: reciprocal rank of the first relevant passage.
   - nDCG@K as well, since graded relevance matters more than binary here.
   - Report at K = 3, 5, 10 in one run. Also report the hit rate at
     `AI_KB_SEARCH_TOP_K` and the fraction of queries that hit the
     widen-on-empty fallback in `KnowledgeBaseRetriever`.

3. GENERATION METRICS, LLM-as-judge with a separate, pinned judge model
   (configure `RAG_EVAL_JUDGE_MODEL`, default to a strong Claude model; the
   judge must never be the same instance as the answering model).
   Build the judge through `createChatModel({ model })` in
   `apps/api/src/services/ai/llm/chat-model.ts`, never with a fresh LangChain
   client. Every model in this repo goes through OpenRouter, so the value is an
   OpenRouter model id, and that factory deliberately uses
   `ChatOpenAICompletions` because the umbrella `ChatOpenAI` class routes the
   newest model ids to an endpoint OpenRouter does not implement and 404s. Read
   the comment above the factory before reaching for your own client.
   - Faithfulness / groundedness: decompose the answer into atomic claims, then
     score each claim as supported / contradicted / not-found against the
     retrieved context only. Report faithfulness as supported over total claims,
     and list every unsupported claim in the run output. This is the
     hallucination metric.
   - Answer relevance: does the answer address the question asked.
   - Correctness: does the answer agree with `referenceAnswer`.
   - Context precision and context recall: of the passages sent to the model,
     how many were actually needed, and was all needed evidence present.
   - Citation accuracy: for P6, every citation the reply emits must point to a
     passage that actually supports the sentence it is attached to.
   - Refusal correctness: on negative cases, did it correctly decline and
     escalate instead of inventing an answer.

4. OPERATIONAL METRICS per case: end-to-end latency broken down by embed,
   Pinecone query, rerank, LLM; token counts in and out; and USD cost.
   Cost is the trap here. Read
   `apps/api/src/services/openrouter-usage.service.ts` before designing this:
   there is no local price table. Cost comes from OpenRouter's
   `/generation?id=<generationId>` endpoint, which 404s until the generation
   record lands and may answer before the cost is finalised, and the service
   gives up after its retries and records zero. So a naive synchronous read at
   the end of a run reports zeros that look like real numbers. Reuse that
   service's fetch-and-retry rather than reimplementing it, collect
   `generationId` per case (graph state already accumulates `generationIds`),
   resolve costs in a settle pass after the run, and mark any case whose cost
   never resolved as unknown rather than as 0.00. Quality without latency and
   cost is not a usable result, and a fake zero is worse than a blank.

5. RUNNER
   - `pnpm eval:rag --dataset <path> --k 5 --tag multi-hop` runs the real
     retrieval and graph code paths, not a reimplementation. Reuse `searchKb`
     and `generateAiReply` so the harness measures production behavior.
   - Output: a JSON report plus a human-readable table, written to
     `packages/rag-eval/reports/<timestamp>.json`.
   - Support `--baseline <report.json>` to diff against a previous run and
     fail the process when any metric regresses beyond a configurable delta.
   - Judge calls must be cached by (case id, answer hash) so reruns are cheap.
   - It must run against a fixture KB with no live customer data.

6. CI: add a workflow step that runs the harness on a small smoke subset and
   posts the metric table. Do not block merges on the full dataset.

Tests: unit tests for each metric function using hand-computed fixtures (a
worked Precision@5 of 0.2, an MRR of 1/3, a faithfulness case with one
unsupported claim). The judge must be mocked in unit tests.

Docs: new `__specs/39-rag-evaluation.md` covering the metric definitions, the
dataset schema, how to add cases, and how to read a report. Add a RUNBOOK
section on running an eval before and after a retrieval change.
Add all new env vars to `.env.example`.

DONE WHEN, all of these and not most:
- `pnpm eval:rag` runs end to end from a clean checkout against the committed
  fixture KB and writes a report. No hidden local state.
- At least 40 golden cases exist covering all the case types named above, and
  the negative cases genuinely have no answer in the fixture KB. Verify that,
  do not assume it.
- Every metric function has a unit test against a hand-computed fixture, and
  the judge is mocked in every unit test.
- `--baseline` exits non-zero on a regression. Prove it by seeding one.
- A full run's judge cost in USD is printed and recorded in the changelog, so
  P12 can price the eval budget from a real number. Any case whose cost did not
  resolve is reported as unknown, never as zero. Assert that distinction, it is
  the difference between a budget and a guess.
- The harness calls `searchKb` and `generateAiReply`. Grep the package and
  confirm no parallel retrieval or prompt logic crept in, because the moment it
  does the harness stops measuring production.
- `__specs/39-rag-evaluation.md` and the RUNBOOK section exist and match what
  actually shipped.
```

## P3. Query understanding and rewriting

```
>>> PROMPT P3

Depends on: P2 to measure it. Nothing else.
Ships behind: `AI_QUERY_REWRITE_ENABLED`. Turn it on by default only after the
harness says it wins.
Blast radius: a new service in front of `searchKb`, plus one extra small-model
call per turn. No storage change, no migration.
Budget: one small-model call per turn, under 400ms p95, under 10 percent of the
turn's total cost. The optional follow-up round doubles retrieval for the small
share of turns that trigger it. Exceed either ceiling and it ships off by
default.

Stop sending the raw user utterance to the retriever. Add a query understanding
stage in front of `searchKb`.

Today the query is whatever string the model passes to the
`search_knowledge_base` tool in `tools/builtin.tools.ts`, embedded verbatim.
Follow-ups ("what about the annual one?"), typos, multi-part questions and
chatty phrasing ("hey so I was wondering if maybe you could tell me whether")
all embed poorly.

Implement `apps/api/src/services/ai/retrieval/query-rewrite.ts`:
1. HISTORY CONDENSATION: rewrite a context-dependent follow-up into a
   standalone question using the last N turns from the conversation. This is
   the single highest-value item here for a chat product.
2. NORMALIZATION: strip pleasantries, expand the org's known acronyms and
   product names (source them from the agent config and KB source titles),
   correct obvious typos.
3. DECOMPOSITION: split a multi-part question into sub-queries, retrieve for
   each, and merge the result sets with deduplication by chunk id.
4. MULTI-QUERY EXPANSION: generate 2 to 3 paraphrases of the query, retrieve
   for each, fuse the results (Reciprocal Rank Fusion). This raises recall on
   vocabulary mismatch between how customers ask and how docs are written.
5. HyDE, optional and behind a flag: generate a hypothetical answer and embed
   that instead of the question. Measure it, it helps on some corpora and hurts
   on others. Only keep it if the harness says it wins.
6. ONE FOLLOW-UP ROUND, for the questions decomposition cannot answer in a
   single pass. A multi-hop question ("is the plan my account is on covered by
   the EU refund policy?") needs the second query to be written from the first
   round's results. After the merged results come back, ask the same small
   rewrite model one question: given the sub-queries and what came back, is
   anything still unanswered, and if so what single query would answer it. If it
   names one, run exactly one more retrieval and merge. Hard rules: at most one
   extra round ever, no planner node, no new graph nodes, no sufficiency-check
   model, and the whole thing behind `AI_QUERY_FOLLOWUP_ROUND_ENABLED` (default
   off until the harness says it earns its cost). This is the bounded version of
   "let the agent plan what to retrieve and in what order", and it stays bounded
   because an unbounded planner is the most expensive thing you could add to a
   per-turn path.

Constraints:
- Use a small, fast model for rewriting (`AI_QUERY_REWRITE_MODEL`, an OpenRouter
  model id, default to a Haiku-class model), not the main answering model. Build
  it with `createChatModel({ model })` from `llm/chat-model.ts` like every other
  model call in this repo; do not construct a client of your own, the factory
  exists to avoid a 404 the umbrella class causes on newer model ids. Budget
  under 400ms p95.
- Cache rewrites by (conversationId, raw query hash) for the turn.
- Degrade to the raw query on any failure or timeout. Rewriting is an
  enhancement, never a hard dependency, matching the existing degradation style
  in `search.service.ts`.
- Carry both `originalQuery` and `rewrittenQuery` on graph state and log them,
  so the telemetry prompt later in this file can persist them without
  re-deriving anything. Add the fields to
  `apps/api/src/services/ai/graph/state.ts` using its existing helpers
  (`lastWins` for a scalar, `appendReducer` for a list), the same way `kbHits`,
  `toolCallLog` and `generationIds` are declared. Do not introduce a second
  state-carrying mechanism.
- Feature flags: `AI_QUERY_REWRITE_ENABLED`, `AI_QUERY_EXPANSION_COUNT`,
  `AI_QUERY_HYDE_ENABLED`.

Tests: follow-up condensation with a real conversation fixture, acronym
expansion, decomposition of a two-part question, RRF fusion ordering, timeout
fallback to the raw query.

Measurement: P2 harness before and after, specifically on the paraphrased,
misspelled and follow-up tagged subsets. Report Recall@5 and MRR delta plus the
added p95 latency and per-turn cost.

DONE WHEN, all of these and not most:
- Follow-up condensation works on a real multi-turn fixture: "what about the
  annual one?" retrieves what the standalone question would have.
- Rewriting adds under 400ms at p95 on the fixture set, and that number is in
  the changelog.
- Every failure path degrades to the raw query. Test the timeout, the malformed
  response and the provider error as three separate cases.
- Both queries are on graph state and in the logs, ready to be persisted.
- The harness shows a Recall@5 or MRR gain on the paraphrased, misspelled and
  follow-up subsets. If it does not, ship it off by default and say so plainly.
- HyDE survives only if the numbers justify it. If they do not, delete it rather
  than leave a dead flag behind.
- A multi-hop fixture that a single retrieval pass provably fails is answered
  with the follow-up round on. The test names the question and both queries.
- The follow-up round fires at most once per turn, asserted by call count, and
  never fires on a simple question. Report what share of fixture turns trigger
  it and what it costs on those turns.
```

## P4. Hybrid retrieval, keyword plus vector

```
>>> PROMPT P4

Depends on: P2 to measure it, P3 whose rewritten query feeds both legs.
Ships behind: `KB_HYBRID_ALPHA`, so dense-only is always one config change away.
Blast radius: the largest in this phase. A new collection, a backfill across
every org's knowledge base, possibly a new embedding model, and the retrieval
hot path. Four separable changes ride on one backfill, so keep them separable in
the numbers even though they ship together.
Budget: one backfill, priced by a dry run before it writes a single vector. The
lexical leg adds no LLM cost at all. Retrieval p95 must not rise by more than 50
percent.

Add keyword search alongside vector search and fuse the results. Pure dense
retrieval misses exact matches: SKUs, error codes, order numbers, product names,
policy clause numbers, and rare terms that customers paste verbatim.

Implement:
1. A lexical index over the same chunks. Evaluate and choose, then justify in
   the spec:
   (a) MongoDB Atlas Search / `$text` over a new `KbChunk` collection that
       mirrors the chunk text (the repo already runs Mongo, and chunk text is
       currently only in Pinecone metadata, which is itself a smell worth
       fixing), or
   (b) Pinecone sparse-dense hybrid vectors if the account's index type
       supports it, or
   (c) an in-process BM25 index, only if the largest KB in production makes
       that safe (measure it, do not assume).
   Recommend (a) unless the account clearly supports (b), because it also gives
   the system a durable, queryable copy of chunk text outside the vector store.
2. Persist chunks to Mongo during ingestion regardless of the choice above.
   Retrieval currently reads chunk text from Pinecone metadata truncated at
   8000 chars, which is fragile. Backfill the mirror for every existing source
   by extending the script that already does this job, `apps/api/scripts/
   reembed.ts` (`pnpm kb:reembed`, already supports `--all` and `--org` and
   already runs sources through the real ingestion pipeline). Add resumability,
   a `--dry-run` that reports the per-source delta without writing, and a cost
   estimate printed before the first write. Do not write a second re-embed
   script beside it.
3. While building the mirror, capture the markdown heading path for each chunk
   ("Billing > Refunds > EU") and store it as `headingPath` on both the mirror
   row and the Pinecone metadata. This is a parse of headings already present in
   the text, not a re-chunk, so it costs one pass over content you are reading
   anyway. Prepend it to the embedded text and measure whether that alone moves
   Recall@5, since it is the cheapest part of what structure-aware chunking
   would have bought.
4. Repair the chunk boundaries that fixed-size slicing broke, in the same pass.
   `chunkText()` in `apps/api/src/utils/chunker.ts` cuts a 1200-char window and
   can hard-cut at `end - 200`, which splits markdown tables, fenced code blocks
   and list groups mid-structure. While the text is open in front of you, detect
   chunks whose boundary falls inside one of those three structures and re-cut
   on the structure's edge instead, merging or splitting only the chunks that
   are actually broken. This is a bounded repair against boundaries already
   present in the markdown: no semantic breakpoint model, no embedding-similarity
   splitting, no change to the target chunk size, and no new dependency. Put the
   count of repaired chunks and the share of the corpus they represent in the
   changelog, so it is clear whether this mattered.
5. The backfill is the one moment a reindex is already paid for, so settle the
   embedding model in the same pass. The current one is `text-embedding-3-small`
   (`EMBEDDING_MODEL` in `.env.example` and `embedding.service.ts`). Benchmark 2
   or 3 alternatives on the P2 fixture set on dimension, cost, provider latency
   and measured Recall@5, and ship whichever wins. If the incumbent wins, say so
   with the table. Use instruction-prefixed embeddings if the chosen model
   supports asymmetric query and document prefixes. Do not fine-tune or train
   anything.
6. Fuse dense and lexical result lists with Reciprocal Rank Fusion (default) and
   support a weighted-score alternative behind `KB_HYBRID_FUSION`. Weight via
   `KB_HYBRID_ALPHA` (1.0 = dense only, 0.0 = lexical only, default 0.5) so the
   harness can sweep it.
7. Keep the tenancy guarantee absolute: the lexical query MUST be AND-scoped to
   `organizationId` and `agentId`, with the same hard guard and the same refusal
   to run unscoped that `searchKb` already implements. Extend
   `apps/api/src/__tests__/rls.test.ts` to cover the lexical path.
8. Both legs run in parallel; total retrieval latency must not exceed the
   current p95 by more than 50 percent. Degrade to dense-only if the lexical leg
   fails or times out.

Tests: exact-token queries (an order id, an error code) that dense retrieval
demonstrably misses, RRF ordering with hand-computed ranks, cross-tenant
isolation on the lexical path, and dense-only fallback.

Measurement: P2 harness with alpha at 0.0, 0.3, 0.5, 0.7, 1.0, and separately
across the candidate embedding models. Report the Recall@5 / MRR curve, pick the
alpha default from the data rather than from intuition, and state how much of
the total gain came from the lexical leg, from heading paths, from boundary
repair, and from the embedding model. Four changes ride on one backfill here, so
attributing them is the whole point.

DONE WHEN, all of these and not most:
- The backfill is resumable, has a dry run, reports its cost before writing, and
  has actually been run against the largest available KB with the duration and
  USD recorded.
- Chunk text is read from Mongo everywhere in the retrieval path. The truncated
  8000-char Pinecone metadata is no longer anyone's source of truth.
- `rls.test.ts` covers the lexical leg, and an unscoped lexical query refuses to
  run exactly as `searchKb` already refuses.
- An exact-token query that dense retrieval provably missed now hits. The test
  names the specific query and the specific chunk.
- The lexical leg failing or timing out degrades to dense-only with a log line.
  Asserted.
- A chunk that split a markdown table, a fenced code block or a list group is
  repaired, proven by a fixture document containing all three. Chunks that were
  not broken come back byte-identical.
- The changelog attributes the gain four ways: lexical leg, heading paths,
  boundary repair, embedding model. One backfill, four changes, four numbers.
```

## P5. Two-stage retrieval with cross-encoder reranking

```
>>> PROMPT P5

Depends on: P4 for the candidate pool, P2 to measure it.
Ships behind: `KB_RERANK_ENABLED`, `KB_RERANK_PROVIDER`.
Blast radius: the retrieval hot path plus one external call per turn. This is
also where "no relevant evidence" becomes expressible, which changes escalation
behavior for real customers.
Budget: one rerank call per turn. Report USD and p95 added per turn and state
whether the precision gain justifies it at the default candidate count. A hosted
reranker is cheaper per call than an LLM reranker, so prefer one.

Implement high recall first, high precision second: retrieve a wide candidate
set cheaply, then rerank with a cross-encoder before anything reaches the model.

1. STAGE 1, widen: fetch `KB_RERANK_CANDIDATES` (default 50) candidates from the
   hybrid retriever built in P4, with the score floor relaxed or removed.
   Today `AI_KB_SEARCH_TOP_K` doubles as both the candidate count and the final
   context size. Separate those two concerns explicitly.
2. STAGE 2, rerank: score every candidate against the query with a cross-encoder
   and keep the top `AI_KB_SEARCH_TOP_K` (currently 8) for the prompt.
   Provider options, implement behind one `Reranker` interface in
   `apps/api/src/services/ai/retrieval/rerank.ts` so it is swappable:
   - a hosted reranker API (Cohere Rerank, Voyage, or Pinecone's rerank
     endpoint). The `mcp__pinecone__rerank-documents` MCP tool is evidence that
     this account has Pinecone rerank; it is not the integration path. Server
     code calls the Pinecone REST API through the existing client in
     `apps/api/src/config/pinecone.ts`, which already handles the
     missing-key noop case you should mirror.
   - or an LLM-as-reranker fallback using the small model from P3, built with
     `createChatModel` like every other model call here.
   Config: `KB_RERANK_PROVIDER`, `KB_RERANK_MODEL`, `KB_RERANK_ENABLED`,
   `KB_RERANK_CANDIDATES`, `KB_RERANK_TIMEOUT_MS`.
3. THRESHOLDING ON A CALIBRATED SCORE: the reranker's score is comparable across
   queries in a way raw cosine similarity is not. Move the "do we have evidence
   at all" decision onto the rerank score, and revisit the
   `widenOnEmpty` hack in `kb-retriever.ts`, which today lets a
   zero-relevance passage into the prompt. With a calibrated score, an honest
   "no relevant evidence" becomes possible and should route to the existing
   escalation path plus a `KnowledgeGap` record.
4. Degrade to stage-1 ordering on reranker failure or timeout, and log it.
5. Carry the rerank scores on graph state and log them, so the telemetry prompt
   later in this file can persist the rank correction (how often the reranker's
   top 1 was not stage 1's top 1) without recomputing it.

Tests: reranker reorders a planted case where the lexically closest passage is
not the relevant one, timeout fallback preserves stage-1 order, tenancy holds
through both stages, and the empty-after-rerank path escalates rather than
answering.

Measurement: P2 harness with rerank on and off. Expect Precision@5 and
faithfulness to rise. Report the latency and cost added per turn, and state
plainly whether the trade is worth it at the default candidate count.

DONE WHEN, all of these and not most:
- `AI_KB_SEARCH_TOP_K` no longer doubles as the candidate count. Two settings,
  two defaults, both documented.
- A planted case where the lexically closest passage is not the relevant one
  gets reordered correctly.
- Reranker timeout or failure preserves stage-1 ordering. Asserted.
- `widenOnEmpty` is gone or gated on a calibrated score. Write the test that
  used to be able to push a zero-relevance passage into the prompt, and watch it
  fail to.
- An honest "no relevant evidence" routes to escalation and writes a
  `KnowledgeGap`.
- Precision@5 and faithfulness both rise, and the added latency and USD per turn
  are stated with a plain verdict on whether the trade is worth it at the
  default candidate count.
```

## P6. Grounded prompting and enforced citations

```
>>> PROMPT P6

Depends on: P5 for a calibrated no-evidence signal and a stable
passage-to-source mapping.
Ships behind: `AI_MAX_UNCITED_RATIO`. The grounding instructions themselves are
not flagged, they are the point.
Blast radius: `prompts.ts` and `finalize.node.ts`. This changes what every
customer sees on every turn. Treat the persona and tone tests as a contract.
Budget: prompt tokens per turn must not rise. Deduplication and the token budget
should lower them. If they rise, report by how much and why.

Rework the answering prompt so it is built around the retrieved context and the
model can only answer from it, with citations.

Current state: `apps/api/src/services/ai/prompts.ts` is a large prompt builder,
and KB passages arrive as a tool result. Audit what the model is actually told
about grounding today before changing anything, and quote it in the changelog.

1. CONTEXT BLOCK FORMAT: render each passage with a stable citation marker,
   its source title, heading path and URL, for example
   `[1] Billing > Refunds (support.example.com/refunds): <text>`.
   Markers must be stable within a turn and map to the citation objects already
   persisted on the message.
2. GROUNDING INSTRUCTIONS, explicit and testable:
   - Answer only from the numbered passages provided.
   - Attach the citation marker to every factual sentence.
   - When the passages do not contain the answer, say so plainly and take the
     escalate action rather than reasoning from general knowledge. Distinguish
     "not in the knowledge base" from "the customer's account does not have it",
     the tools cover the latter.
   - Never cite a passage that does not support the sentence.
   - Keep the existing persona and tone rules intact, grounding is an addition,
     not a replacement.
3. EXTEND THE CITATION SHAPE, because the current one cannot carry markers.
   Verified current state: `Message.sources` is
   `[{ sourceId, sourceTitle, url, score }]` with no marker, no chunk id and no
   heading path, and `apps/widget/src/components/Citations.tsx` renders it as a
   collapsible list under the reply, not as inline anchors. So "reuse the
   existing shape" is not available to you for `[1]`-style markers, and quietly
   inventing a parallel format is the failure mode to avoid. Add a `marker`
   (the integer shown in the text) and a `chunkId` to the `sources` subdocument,
   keep every existing field and its meaning intact so today's rendering keeps
   working untouched, and teach `Citations.tsx` to also resolve an inline marker
   to its entry. A reply with no markers must render exactly as it does today.
4. CONTEXT HYGIENE, the two parts of context compression worth keeping. Both
   are mechanical, neither touches the words inside a passage:
   - Collapse cross-passage duplicates before rendering. Chunks overlap by
     design and re-crawled pages repeat themselves, so the same sentence can
     occupy three of five slots.
   - Order passages by score with the strongest at the start and the end of the
     block rather than buried in the middle, which is where attention goes to
     die.
   - Enforce `AI_CONTEXT_TOKEN_BUDGET` by dropping whole passages from the
     bottom of the reranked list, never by truncating mid-passage, and record
     what was dropped. A half-passage is a citation that no longer supports its
     sentence.
   Do not add sentence-level extraction or any other compressor that rewrites,
   summarizes or trims the text inside a passage. Saving tokens by editing
   evidence is how faithfulness dies quietly, and after P5 narrows the set to a
   handful of relevant passages there is little left to save.
5. STRUCTURED OUTPUT: have the model emit answer text with markers, then map
   each marker to its entry in the extended `sources` array from step 3, so the
   widget resolves inline markers and still renders the source list it renders
   today. One format, extended, not two formats side by side.
6. CITATION VALIDATION at finalize time: drop any citation whose marker was
   never used, and flag any factual sentence with no marker. When the
   unsupported-sentence ratio exceeds `AI_MAX_UNCITED_RATIO`, lower the turn's
   confidence so the existing `AI_CONFIDENCE_THRESHOLD` escalation catches it.
   This turns faithfulness into a live control, not just a metric.
7. NEGATIVE CASE BEHAVIOR: with zero passages above the P5 rerank threshold,
   the prompt must not include an empty context block and must not encourage a
   best-effort guess.

Tests: a golden-prompt snapshot test for the context block, a test that an
answer citing a non-existent marker is caught, a no-evidence case that produces
a refusal plus escalation, and confirmation that tone and persona tests still
pass.

Measurement: P2 harness, focused on faithfulness, citation accuracy and refusal
correctness on the negative subset. Faithfulness is the headline number for this
prompt, report it before and after.

DONE WHEN, all of these and not most:
- A golden-prompt snapshot test covers the context block, and a human reviewed
  the snapshot before it was committed.
- An answer citing a marker that does not exist is caught at finalize and never
  reaches the customer. Asserted.
- A zero-evidence turn produces a refusal plus escalation, with no empty context
  block in the prompt.
- Existing tone and persona tests pass unchanged. Grounding is an addition, not
  a rewrite.
- The widget renders inline markers and the source list through the extended
  `Citations.tsx`, and an older message with no markers renders exactly as it
  did before. Verified with chrome-devtools MCP on both, recorded in
  `QA_TEST_RESULTS_<n>.md`.
- Faithfulness and citation accuracy both rise, reported before and after.
  Faithfulness is the headline number for this prompt.
- Deduplication and reordering are measured separately from the grounding
  instructions, so the changelog can say which of the two moved the number.
- Every emitted passage is byte-identical to its stored chunk. Assert it. The
  moment context assembly can edit text, citations stop meaning anything.
```

## P7. Contradictory knowledge base content

```
>>> PROMPT P7

Depends on: P4 for the chunk mirror, P5 for a rerank score good enough to
detect a conflict with.
Ships behind: `KB_CONFLICT_DETECTION_ENABLED`.
Blast radius: chunk metadata, `KnowledgeSource`, the retrieval path, the prompt,
and one new operator control. A metadata backfill is involved, so read what P4's
backfill already did before writing a second one.
Budget: conflict detection runs only when the top-K spans more than one source.
The common single-source turn must not gain a call. Prefer the rerank scores you
already have over a fresh LLM check.

Determine and then fix how this agent behaves when the knowledge base contains
contradictory information (for example an old refund policy page and a new one,
or two crawled pages with different prices).

PART A, investigate (findings feed straight into part B, no separate
report-and-stop step):
- Trace what `searchKb()` returns when two chunks contradict each other: both
  are likely above the score floor, both go into the prompt.
- Read the system prompt construction in `apps/api/src/services/ai/prompts.ts`
  and determine whether the model is given ANY instruction about conflicting
  sources, recency, or source authority.
- Check what metadata is available to disambiguate. A vector carries
  `organizationId`, `agentId`, `sourceId`, `chunkIndex`, `url`, `text`, and
  after P4 a `headingPath` and a row in the Mongo chunk mirror. Note what is
  missing and blocks this prompt: no `updatedAt`, no source priority, no
  version.
- Reproduce it: write a test that seeds two contradictory chunks in the same
  agent's KB and asserts on the current behavior. Document what actually
  happens (does it pick one, blend them, hedge, or hallucinate a merge?).

PART B, implement a conflict policy:
1. Add `sourceUpdatedAt` and an operator-settable `priority` integer (default
   0, higher wins) to `KnowledgeSource`, to the Pinecone chunk metadata and to
   the P4 chunk mirror, with UI to set priority per source. Keep
   `sourceUpdatedAt` accurate on every reingest. Backfill by writing the two
   fields onto existing vectors through the P4 mirror rather than re-embedding
   anything, and say in the changelog whether a metadata-only update was
   possible on this Pinecone index or whether a reingest was unavoidable.
2. Add conflict detection in the retrieval path: when the top-K passages come
   from different sources and the P5 reranker or an LLM check flags them as
   mutually inconsistent on the queried fact, mark the result set as
   `conflicted`.
3. Define the resolution order and implement it: explicit priority, then most
   recent `sourceUpdatedAt`, then highest relevance score.
4. Prompt behavior when `conflicted`: the agent must state the authoritative
   answer, cite it, and must not silently merge. When priority and recency
   cannot break the tie, it must say the sources disagree and escalate per the
   existing escalation path rather than guess.
5. Surface it to the operator: write a `KnowledgeGap`-style record (or extend
   `KnowledgeGap` with a `kind: "conflict"`) so contradictions appear in the
   dashboard for a human to resolve.

Tests: unit tests for the resolution ordering, plus an integration test that
seeds contradictory chunks and asserts the reply cites the higher-priority
source and does not assert the stale fact.

Update `__specs/04-pinecone-firecrawl.md` and `__specs/05-ai-agent-design.md`.

DONE WHEN, all of these and not most:
- A seeded pair of contradictory chunks produces a reply that cites the
  higher-priority source and does not assert the stale fact. This single test is
  why the prompt exists.
- Resolution ordering is unit tested, including the tie that cannot be broken.
- An unbreakable tie escalates. It does not guess, hedge or merge.
- Priority is settable per source in the UI. Verified with chrome-devtools MCP.
- Every existing vector carries `sourceUpdatedAt` and `priority`, and the
  changelog says whether a metadata-only update sufficed or a reingest was
  forced.
- Conflicts appear in the operator dashboard as their own record kind.
```

---

# Phase 3, Make it observable

The pipeline has stopped moving, so it is now worth watching. P8 makes the input
side honest about its failures, P9 records what every turn did, P10 puts both in
front of an operator, P11 turns what that operator sees into index repairs.

## P8. Ingestion observability and failure monitoring

```
>>> PROMPT P8

Depends on: nothing. It can run at any point, including in parallel with the
whole of Phase 2.
Ships behind: no flag. The sweeper interval and failure thresholds are config.
Blast radius: `ingestion.service.ts`, `jobs/embedding-reconcile.job.ts`, a new
model, the KB UI, `notification.service.ts`. It changes what a failed ingest
does, so read the existing status transitions and the reconcile job before
touching either.
Budget: no LLM cost. Stage events are writes; keep them off the request path and
batch them where a single ingest emits many.

Make knowledge ingestion failures visible and diagnosable.

Current state, verified, and more exists than you might assume. Read all of it
before writing anything:
- `ingestion.service.ts` sets `embeddingStatus = "error"` with a single
  `embeddingError` string and increments `retryCount`. There is no per-stage
  record and no error classification, so "it failed" is the entire diagnosis.
- `jobs/embedding-reconcile.job.ts` already runs every 60s and already does two
  of the things this prompt might look like it is asking for. It retries sources
  in `error` while `retryCount < 3` by re-queueing `ingestSource()`, and it
  re-ingests sources stuck in `processing` for more than 15 minutes, which is
  the restart-mid-ingest recovery path. Do not rebuild either. The gap is that
  both are invisible and indiscriminate: retry is blind to whether the error was
  transient or permanent, so an unsupported file type burns three retries and
  then sits silent forever, and nothing surfaces any of it to an operator.
- `embeddingError` is overloaded. The `POST /knowledge/website` route stashes
  crawl ids in it as `firecrawl:<id>` for `jobs/firecrawl-ingest.job.ts` to pick
  up. Do not repurpose or clear that field without following both readers.
- Jobs are plain `setInterval` timers started from `jobs/index.ts`, with no
  queue. That is a deliberate current choice, not an oversight; leave the
  architecture alone here and let P12 price whether it needs to change.

1. STRUCTURED INGESTION EVENTS
   New model `IngestionEvent` (or extend `KnowledgeSource` with an events
   array, justify the choice): sourceId, organizationId, agentId, stage
   (`parse` | `chunk` | `embed` | `upsert` | `cleanup`), status, durationMs,
   chunkCount, byteSize, errorCode, errorMessage, attempt, createdAt.
   Emit one per stage per attempt from `ingestSource()`.

2. CLASSIFY ERRORS instead of storing a raw message. Define an error taxonomy
   and map to it: unsupported file type, parse failure, empty extraction
   (parsed but produced zero usable text, currently silently succeeds with
   `chunkCount: 0`), embedding provider error, rate limited, budget exceeded,
   Pinecone upsert failure, partial upsert, timeout. Each needs an operator-
   readable message and a suggested action.

3. FIX THE SILENT FAILURES, at minimum:
   - Zero-chunk ingests currently end as `synced` with `chunkCount: 0`
     (`ingestion.service.ts` around line 117). That is a failure: a scanned PDF
     with no text layer, an empty crawl. Give it its own status and surface it.
     Note that the reconcile job only retries `error` and `processing`, so today
     these sources are never revisited by anything.
   - A partial embed/upsert failure leaves Pinecone and `source.pineconeIds`
     inconsistent. Make the write atomic or make recovery explicit.
   - Make the existing retry loop discriminating instead of blind. Feed the
     taxonomy from step 2 into `embedding-reconcile.job.ts`: permanent classes
     (unsupported file type, parse failure, empty extraction) must not consume
     retries at all and should go straight to a terminal state an operator can
     see; transient classes (rate limited, provider error, timeout) keep the
     bounded retry but gain backoff instead of a flat 60s loop; budget-exceeded
     waits for budget rather than burning attempts. A source that exhausts its
     retries must raise something, not go quiet.

4. OPERATOR SURFACE
   - Per-source detail view showing the stage timeline, the classified error,
     the suggested fix, and a Retry action.
   - An org-level ingestion health widget feeding the P10 dashboard: sources by
     status, failure rate by error class, mean ingest duration by source type,
     retry counts, and sources currently sitting in the reconcile job's recovery
     paths.
   - Make the reconcile job's work observable rather than duplicating it. Every
     retry and every stuck-processing recovery it performs should emit an
     ingestion event, so an operator can see that a source has been silently
     re-ingested four times instead of only seeing its latest status. Its
     15-minute `STUCK_PROCESSING_MS` and 3-attempt `MAX_RETRIES` constants
     become configurable and land in `.env.example`.

5. Alerting through `notification.service.ts` when an org's ingestion failure
   rate crosses a threshold, and structured logs with a consistent `[kb]`
   prefix and a correlation id per ingest run.

Tests: cover each error class, the zero-chunk case, the reconcile job's retry
and stuck-processing paths (including that a permanent error class consumes no
retries), and the partial-upsert recovery.

Docs: `__specs/04-pinecone-firecrawl.md`, `RUNBOOK.md` (a "knowledge ingestion
is failing" triage section), `.env.example` for new thresholds.

DONE WHEN, all of these and not most:
- Every error class in the taxonomy has a test that produces it and asserts both
  the operator-facing message and the suggested action.
- A zero-chunk ingest no longer ends as `synced`, and an operator can see why.
- Killing the process mid-ingest leaves a source the reconcile job recovers
  within the configured timeout, and that recovery is now visible as an event.
  Test it by actually killing the process.
- A partial upsert leaves Pinecone and `source.pineconeIds` consistent, or
  leaves an explicit recoverable state with a Retry that works.
- A permanent error class consumes zero retries and reaches a terminal state an
  operator can see. A transient one retries with backoff and stops. Assert both
  against the reconcile job, not against a new one.
- `embeddingError` still carries `firecrawl:<id>` correctly and the Firecrawl
  poll job still picks those crawls up. Assert it; this field has two readers.
- Retry from the UI succeeds on a source that failed transiently. Verified with
  chrome-devtools MCP and recorded in `QA_TEST_RESULTS_<n>.md`.
```

## P9. Online telemetry for retrieval and generation confidence

```
>>> PROMPT P9

Depends on: P2 merged, its judge is reused here for sampled faithfulness.
Ships behind: `RAG_TELEMETRY_ENABLED` (default on),
`RAG_FAITHFULNESS_SAMPLE_RATE` (default 0.05).
Blast radius: a new collection plus write points in the graph runner,
`kb-retriever.ts` and `finalize.node.ts`. Every write is fire and forget.
Budget: one fire-and-forget document write per turn, plus judge calls at
`RAG_FAITHFULNESS_SAMPLE_RATE` (default 0.05). Zero added latency on the reply
path, and the sampling respects the org budget gate.

Persist per-turn RAG telemetry in production so retrieval and generation
quality can be monitored live, not only in offline eval (P2).

1. NEW MODEL `apps/api/src/models/RagTurnMetric.ts`. Follow
   `apps/api/src/models/ToolCallLog.ts` rather than inventing a shape: it is the
   existing per-turn telemetry model in this repo and it already settles the
   conventions you need (organizationId / agentId / conversationId scoping,
   masked arguments, `durationMs`, a status enum, `timestamps` with
   `updatedAt: false`, and a 90-day TTL index on `createdAt`). Match it.
   Fields:
   organizationId, agentId, conversationId, messageId, createdAt,
   originalQuery, rewrittenQuery (both already on graph state, put there by
     the query rewriter),
   retrieval: { topK, minScore, hitCount, topScore, meanScore, scoreSpread,
     widenedOnEmpty, sourceIds[], latencyMs },
   generation: { confidence, action, citationCount, citedSourceIds[],
     answerLength, model, promptTokens, completionTokens, costUsd, latencyMs },
   flags: { noHits, lowConfidence, escalated, conflicted },
   toolTurns.
   Index on (organizationId, agentId, createdAt) and on flags for dashboards.
   Add a TTL or a retention job per `__specs/12-security-compliance.md`, and
   store no raw customer PII beyond what the query already contains; run the
   query text through the existing masking in
   `apps/api/src/services/integrations/piiMask.ts` before persisting.

2. INSTRUMENT the real path:
   - Capture retrieval stats in `KnowledgeBaseRetriever.searchHits()` and carry
     them on the graph state (`apps/api/src/services/ai/graph/state.ts` already
     accumulates `kbHits`; add a parallel `retrievalStats`).
   - Capture generation stats in `nodes/finalize.node.ts`, which already
     produces `confidence` and `action`.
   - Write the record from the graph runner after the turn is persisted.
     Fire-and-forget: a telemetry failure must never fail a customer reply.

3. RETRIEVAL CONFIDENCE, a real signal instead of a raw cosine score:
   Define and implement a normalized `retrievalConfidence` in [0,1] derived from
   top score, the gap between rank 1 and rank 2, and hit count. Document the
   formula in the spec. Emit it alongside the raw scores; do not silently
   replace the existing threshold behavior.

4. ONLINE FAITHFULNESS SAMPLING:
   Add a sampled async faithfulness check (rate controlled by
   `RAG_FAITHFULNESS_SAMPLE_RATE`, default 0.05) that runs the P2 judge on real
   turns out of band and writes the score onto the `RagTurnMetric`. It must not
   add latency to the customer reply and must respect the org's AI budget gate
   in `budget-alert.service.ts`.

5. ALERTS: reuse the notification path in
   `apps/api/src/services/notification.service.ts` to alert an org when, over a
   rolling window, the no-hit rate, low-confidence rate or escalation rate
   crosses a configurable threshold.

Tests: unit tests for the confidence formula and for the record shape; an
integration test asserting one turn writes exactly one metric record and that a
telemetry throw does not break the reply.

Docs: `__specs/39-rag-evaluation.md` (online section), `__specs/03-data-model.md`
for the new collection, `.env.example` and `__specs/13-env-variables.md`.

DONE WHEN, all of these and not most:
- One customer turn writes exactly one `RagTurnMetric`. Asserted, not observed.
- A throw inside telemetry leaves the customer reply byte-identical. Test it by
  throwing on purpose.
- Query text passes through `piiMask.ts` before persistence, asserted on a
  fixture containing an email address and a card number.
- The `retrievalConfidence` formula is documented in the spec and unit tested at
  its boundaries, including the zero-hit and single-hit cases.
- Sampled faithfulness adds zero latency to the reply path. Measure it.
- Every query P10 will run has an index, and `explain()` shows it being used.
- Retention or TTL is configured per `__specs/12-security-compliance.md`.
```

## P10. RAG metrics dashboard

```
>>> PROMPT P10

Depends on: P9, merged and collecting long enough that the page has something
to render. P8 feeds the ingestion panel, P2 feeds the eval history panel.
Ships behind: no flag. It is a new page.
Blast radius: new read-only endpoints and one new page. No write path anywhere,
which is what makes this the safest prompt in the file.
Budget: read-only aggregations only. Every one must be index-backed. A dashboard
load that scans a collection is a bug, not a slow page.

Build the RAG metrics dashboard on top of the `RagTurnMetric` data from P9 and
the eval reports from P2. Do not start before P9 is merged.

BACKEND: new routes in `apps/api/src/routes/analytics.routes.ts` (or a new
`rag-metrics.routes.ts`), org-scoped and RLS-safe like the existing analytics
endpoints, with a date range and agent filter:
- retrieval summary: Recall@K proxy (share of turns whose cited source was in
  the top K), Precision@K, MRR, mean top score, score distribution histogram,
  no-hit rate, widen-on-empty rate, p50/p95 retrieval latency.
- generation summary: mean confidence, confidence histogram, sampled
  faithfulness score, escalation rate, thumbs up/down from `MessageFeedback`,
  citation rate and mean citations per answer.
- cost and latency: tokens and USD per turn over time, p50/p95 end-to-end.
- top failing queries: highest-volume queries with no hits or low confidence,
  joined to `KnowledgeGap`.
- per-source health: for each `KnowledgeSource`, retrieval count, mean score
  when retrieved, and the never-retrieved list (dead weight in the index).

FRONTEND: a "RAG Quality" page in the dashboard app (`apps/web`, under the
existing analytics area, matching the current page conventions and design
system in `packages/ui`). Sections:
1. Header KPI row: faithfulness, mean confidence, no-hit rate, escalation rate,
   p95 latency, cost per conversation. Each with a period-over-period delta.
2. Retrieval panel: Recall@K / Precision@K / MRR at K = 3, 5, 10 with a K
   selector, and a score distribution chart with the current
   `AI_KB_SEARCH_MIN_SCORE` drawn as a threshold line so an operator can see
   how much the floor is cutting.
3. Generation panel: confidence over time, faithfulness sample over time,
   unsupported-claim examples (click through to the conversation).
4. Knowledge health panel: never-retrieved sources, top knowledge gaps, sources
   with failing ingestion (from P8).
5. Eval history panel: the last N offline eval runs from `packages/rag-eval`
   reports, so an offline regression is visible next to production numbers.

Requirements:
- Every metric tile must have a tooltip with its plain-language definition
  ("Precision@5: of the 5 passages retrieved, how many were relevant. 1 of 5
  relevant is 20 percent.").
- Empty states for orgs with no data yet.
- Server-side aggregation with Mongo aggregation pipelines, not client-side
  rollups. Add the indexes the aggregations need.
- Verify with chrome-devtools MCP against seeded data and record findings in
  `QA_TEST_RESULTS_<n>.md`.

Docs: update `__specs/11-page-wiremap.md` with the new page and
`__specs/07-api-specification.md` with the new endpoints.

DONE WHEN, all of these and not most:
- Every endpoint is org-scoped and RLS-safe, with a test proving one org cannot
  read another's metrics. Do not take the existing middleware on faith.
- Every aggregation runs server-side and has the index it needs. No client-side
  rollups survive review.
- Every metric tile has its plain-language tooltip, and the definitions match
  `__specs/39-rag-evaluation.md` word for word. Two definitions of Precision@5
  in one product is a bug.
- Empty states render correctly for an org with zero turns.
- The score distribution chart draws the `AI_KB_SEARCH_MIN_SCORE` line, so an
  operator can see what the floor is cutting.
- Verified against seeded data with chrome-devtools MCP at a wide and a narrow
  viewport, recorded in `QA_TEST_RESULTS_<n>.md`.
```

## P11. Feedback-driven index improvement

```
>>> PROMPT P11

Depends on: P9 for telemetry history, P7 for the priority field, P10 for the
surface these actions render into.
Ships behind: the scheduled job behind a flag, default off until the scoring is
trusted on real data.
Blast radius: a new service, four operator actions, and one scheduled job that
touches customer knowledge. That last one is why the confirmation rules below
are not negotiable.
Budget: the scheduled job runs off-peak and re-embeds only sources whose content
hash changed. It must never trigger a full reindex.

Close the loop: use query logs and user feedback to find and repair weak parts
of the index.

Inputs already in the repo: `MessageFeedback` (thumbs), `KnowledgeGap` (queries
whose best KB score fell below `AI_KB_GAP_SCORE_THRESHOLD`),
`ConversationRating`, and after P9 the full `RagTurnMetric` history.

Build `apps/api/src/services/kb/index-health.service.ts`:
1. WEAK CHUNK DETECTION. Score every chunk on: retrieval frequency, mean rank
   when retrieved, mean rerank score, thumbs-down rate of answers that cited it,
   and escalation rate of turns that used it. Flag: never-retrieved chunks
   (dead weight), frequently-retrieved-but-downvoted chunks (misleading), and
   high-score-but-not-cited chunks (retrieved and then ignored by the model,
   usually a chunking problem).
2. GAP CLUSTERING. Cluster open `KnowledgeGap` queries by embedding similarity
   so an operator sees "23 customers asked about EU refund timelines and we have
   nothing", not 23 separate rows. Rank clusters by volume times business
   impact (escalation rate).
3. REPAIR ACTIONS, operator-facing, in the dashboard:
   - Re-ingest and re-embed a single source, targeted, so a full reindex is
     never required to fix one bad document.
   - Add a Q&A pair directly to the KB answering a gap cluster, which becomes
     its own high-priority source.
   - Mark a source stale or lower its priority (uses the P7 priority field).
   - Bulk-delete never-retrieved sources after a review step.
4. AUTOMATION, conservative: a scheduled job that re-embeds sources whose
   content hash changed and flags weak chunks for review. Follow the existing
   job convention exactly: a module in `apps/api/src/jobs/` exporting a single
   `...Once()` function, registered on a `setInterval` in `jobs/index.ts` with
   its interval as a named constant. No new scheduler or queue dependency.
   Never auto-delete and never auto-edit customer knowledge, always require
   confirmation.
5. Surface all of it in the P10 dashboard's knowledge health panel.

Tests: weak-chunk scoring against seeded telemetry, gap clustering, targeted
reindex touching only the intended source's vectors, and confirmation that no
automated path deletes content without confirmation.

Docs: `__specs/04-pinecone-firecrawl.md`, RUNBOOK section "improving answer
quality from feedback".

DONE WHEN, all of these and not most:
- Weak-chunk scoring runs against seeded telemetry and produces all three flag
  types, with a test for each.
- Gap clustering collapses a seeded set of 23 paraphrases of one question into
  one cluster, not 23 rows.
- A targeted reindex touches only the intended source's vectors. Assert it by
  counting what changed, not by reading the code.
- No automated path deletes or edits customer knowledge without an explicit
  confirmation step. Write the test that tries to.
- Every repair action is reachable and works from the P10 dashboard. Verified
  with chrome-devtools MCP.
```

---

# Phase 4, Open questions, answered against the finished system

Run this only after P1 through P11 are implemented and end-to-end tested. Every
question in it was deferred from the implementation prompts so none of them
stalled on a decision that real measurements settle better.

## P12. Answer the open questions against the finished system

```
>>> PROMPT P12

Depends on: P1 through P11, all implemented, verified, and their changelogs
written. Do not start this until that is true.
Ships behind: nothing. This prompt writes documents, not code.
Blast radius: `__specs/` and `E2E_FLOW.md` only. Do not change product code
here. Fixes that fall out of it go in a follow-up prompt of their own.
Budget: analysis only, no product code. The part D load test is the only thing
here that spends money; run it against the fixture KB, not a customer's.

Everything in P1 through P11 is implemented, tested and verified. This prompt is
the only one in this file that produces analysis instead of code, and it runs
last on purpose: every question below was cheaper to answer with a working
system and real measurements than to guess at up front.

Read the changelogs and QA results from P1 through P11 first, then the current
working tree. Where a question can be answered with a number from the P2 eval
harness or the P9 telemetry, use the number. Where it cannot, say so plainly
rather than reaching for a plausible-sounding estimate.

PART A, the pipeline as it now stands
Produce `__specs/37-rag-pipeline-audit.md`: a stage by stage account of
ingestion, retrieval, generation and delivery as they exist AFTER this work,
with file:line references, the remaining failure modes, the input that triggers
each one, and a severity and confidence for each. Include a short "what this
looked like before P2" section so the delta is legible. Close with a ranked list
of the top 10 remaining quality risks and what would address each.

PART B, the flow, drawn
Verify every claim in `E2E_FLOW.md` against the current code, rewrite what has
gone stale, and add Mermaid diagrams for:
1. Ingestion: upload or crawl, parse, chunk, embed, mirror to Mongo (P4),
   upsert, and every `KnowledgeSource.embeddingStatus` transition including the
   budget gate, the stale-vector cleanup, the P8 stage events and every error
   path.
2. Customer message flow: widget, socket handler, `generateAiReply`, the
   LangGraph nodes with their real conditional edges, including the `halt`
   latch, the `maxToolTurns` ceiling and the present-only shortcut.
3. Retrieval, expanded: query rewrite (P3), hybrid dense plus lexical (P4),
   fusion, rerank (P5), context block assembly and citations (P6), with the
   tenancy filter shown on every leg.
4. Escalation and handoff: confidence below `AI_CONFIDENCE_THRESHOLD`, the
   citation-ratio control from P6, explicit escalate, operator takeover, and
   where `KnowledgeGap` and conflict records get written.
5. A sequence diagram for one full customer turn showing every network hop with
   its measured p50 and p95 latency from P9 telemetry, and the failure and
   degradation behavior annotated on each hop.
Every box names the file that implements it. Anything still documented in
`__specs/` but not actually implemented gets a dashed border. Link the diagrams
from `__specs/05-ai-agent-design.md` and `__specs/04-pinecone-firecrawl.md`.

PART C, is this a ReAct agent
Answer precisely, with code evidence, against the graph as it exists now:
1. The ReAct contract: reason, act, observe, repeat until answer.
2. What this graph does per step, mapped onto that contract.
3. Deviations. Address at least: is there an explicit reasoning trace in state
   or only implicit tool-call reasoning? Is there any reflection or self-critique
   step? Is `finalize` a ReAct answer step or a separate judge pass? Is the loop
   bounded by reasoning quality or only by `maxToolTurns`? Does the `halt` latch
   break the cycle mid-trajectory, and is that correct?
4. Whether each deviation is a bug, a deliberate trade-off, or a gap. Quote the
   design comments that justify the deliberate ones.
5. Whether a planning node or a reflection node is worth adding now. P3 ships
   only bounded decomposition and one follow-up round, on purpose. You now have
   the data to answer properly: how many real turns hit that ceiling, and what
   per-turn latency, token and USD cost would a full planner add, priced from
   real P9 telemetry.
Append it to `__specs/05-ai-agent-design.md` as a "ReAct conformance" section.

PART D, what breaks under load
Produce `__specs/38-scale-and-load-risks.md` covering high concurrent traffic,
very large uploaded files, and very large knowledge bases, with file:line
evidence and a table of (failure, trigger threshold, blast radius, evidence,
fix, effort). Cover at minimum: whether ingestion still runs inline and what a
deploy mid-ingest now does given the reconcile job in
`jobs/embedding-reconcile.job.ts`, and whether plain `setInterval` jobs with no
queue (see the deliberate note in `jobs/index.ts`) still hold at the traffic you
are now seeing, including what happens when a reconcile tick's batch of 20
`ingestSource()` calls overlaps the next tick; the concurrency ceiling implied
by `AI_LLM_TIMEOUT_MS` times `AI_MAX_TOOL_TURNS` plus the P3 rewrite and P5
rerank calls; Mongo index coverage on every hot-path query added by P9, P8,
P4 and P11; socket fan-out on a large ingest; in-memory assumptions in
`parsers.ts` and the largest file that survives them; embedding batch partial
failure and what it leaves inconsistent; Pinecone metadata filtering versus
per-org namespaces at scale, and whether `topK` should still be fixed as a KB
grows. Where a threshold cannot be derived from code, write the load test that
would find it, run it against the fixture KB if it is safe to do so, and report
the measured number instead of the guess.

PART E, the decisions that were deferred, now with data
Each of these was parked with a stated default so implementation could proceed.
Present each one as: what the default was, what the numbers now say, what it
would cost to change, and a recommendation. These are mine to decide, so give me
the evidence and the recommendation, not a decision.
1. Eval judge model and budget. P2 and the P9 sampled faithfulness check both
   burn judge tokens. Report the actual USD per full eval run, per CI smoke run
   and per month at the current `RAG_FAITHFULNESS_SAMPLE_RATE`, plus what a
   cheaper judge model does to agreement with the current one on the same cases.
2. Reindex tolerance. P4 backfills a chunk mirror across every customer KB and
   may swap the embedding model, which re-embeds all of it. Report the measured
   duration and USD for the largest real KB, what the backfill's resumability
   survives, and what a customer sees while it runs. Recommend a maintenance
   window shape and say who absorbs the embedding cost.
3. Rerank provider. P5 shipped behind the `Reranker` interface with a default.
   Report the measured Precision@5, faithfulness, p95 latency and USD per turn
   for each provider actually available on this account, and recommend the
   default from that table.
4. Any other assumption that P1 through P11 recorded in a changelog as
   "proceeded under assumption X". Collect them all here. None should be
   discovered later in a diff.

Deliverable: the four documents above, plus a single summary in your reply
ordered by what needs my decision first. Do not change product code in this
prompt. Fixes go in a follow-up.

DONE WHEN, all of these and not most:
- All four documents exist, and every claim in them traces to a file:line, a
  harness number or a telemetry query. No claim rests on recollection.
- Every "proceeded under assumption" line from every changelog in P1 through
  P11 appears in part E. None of them should first surface later in a diff.
- Every deferred decision comes with its measured cost of changing and a
  recommendation, and stops there. The decision is mine.
- Anything you could not determine is listed as such, with the data that would
  settle it. An admitted gap is worth more here than a confident guess.
```
