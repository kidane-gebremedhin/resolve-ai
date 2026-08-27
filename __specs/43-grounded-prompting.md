# 43 — Grounded Prompting and Citations

## What the model was told before

The audit this prompt asked for, quoted verbatim. Grounding was **one line** in
`prompts.ts`:

> `- Ground every factual claim in the knowledge base. Quote or paraphrase what you found — don't invent.`

There was **no context block**. Retrieved passages reached the model only as the
`search_kb` tool result — a JSON blob of `{source, text, score}` with no stable
identity and nothing to point at. There was nothing to cite, so nothing cited.

Two other lines actively worked against grounding:

> `- When hits are returned, USE them in your reply. Hits with score >= 0.5 are strong matches; hits in the 0.2-0.5 range are still useful context — summarize what's there rather than claiming the KB is empty.`

> `- Only say "I don't have that information" AFTER you have searched the knowledge base with at least two different queries and both came back empty.`

The first tells the model to answer from weak evidence rather than admit a gap.
The second was written before a calibrated relevance signal existed; with P5's
reranker a single search now gives a definitive answer, and telling the model to
search twice more wastes a turn and invites it to keep going until something
looks usable.

## The context block

Built in `finalizeNode` from `state.kbHits` and injected as a system message:

```
[1] Billing and Plans > Plans — https://support.example.com/billing
The Team plan is $99 per month or $990 annually.

[2] Security and Data Handling > Encryption
Data is encrypted at rest with AES-256.

[3] Refund Policy > The 30-day window — https://support.example.com/refunds
Any plan can be refunded in full within 30 days of purchase.
```

Markers are assigned by **display position**, not by score. If they followed
score, the block would read `[1] … [3] … [2]` down the page and a model asked to
cite `[1]` would reach for whatever it saw first.

That snapshot is a committed test. A diff in it changes every reply the product
produces, so it should require a human to read the new text and agree with it.

### Assembly is mechanical, never editorial

Three transformations, none of which touch the words inside a passage:

**Deduplication.** Chunks overlap by design and re-crawled pages repeat
themselves, so the same sentences can occupy three of five slots — the model
then sees one fact three times and another not at all. Identity is by chunk id
first (the same chunk found by both retrieval legs) and normalised text second
(different chunks holding the same content). Highest score wins, so the
surviving citation points at the passage retrieval actually ranked.

**Ordering for attention.** Attention degrades in the middle of a long context.
Given passages sorted by score, they are placed alternately at the front and the
back — rank 1 leads, rank 2 closes, and the weakest end up in the middle where
the least is lost.

**Token budget.** `AI_CONTEXT_TOKEN_BUDGET` is enforced by dropping **whole
passages** from the bottom of the ranked list. Never by truncating one: a
half-passage is a citation that no longer supports the sentence attached to it,
and the model reads a fragment as though it were the whole story. At least one
passage is always kept — an empty block for a question that *did* retrieve
evidence reads as "no evidence" and triggers a refusal for an answerable
question.

**What is deliberately absent:** sentence-level extraction, summarisation, or any
compressor that rewrites text. `assertVerbatim()` throws if a rendered passage
differs from its stored chunk, which makes this structural rather than a
promise. The moment assembly can edit text, every citation in the product points
at our paraphrase instead of the evidence, and nothing else in the system would
notice.

## Citation validation

At finalize, before the reply is persisted or sent:

**Impossible markers are stripped.** A model asked to cite will sometimes emit
`[4]` when three passages were given. Left in place it renders as a citation the
customer can click that resolves to nothing — which looks *more* like evidence
than no citation at all.

**Uncited factual sentences are counted.** When the ratio exceeds
`AI_MAX_UNCITED_RATIO`, the turn's confidence is lowered below
`AI_CONFIDENCE_THRESHOLD` so the **existing** escalation path catches it. No new
escalation route, just an honest input to the one already there. This is what
turns faithfulness from a number read afterwards into a control that acts during
the turn.

The sentence classifier is deliberately conservative. Greetings, questions,
offers to help and honest refusals are **not** factual, so a friendly reply does
not score as badly as a fabricated one — and an honest "I don't have that
information", which is exactly the behaviour wanted on a negative case, does not
lower confidence for being right.

## The extended citation shape

`Message.sources` gains `marker`, `chunkId` and `headingPath`. Every existing
field keeps its meaning, so a message written before this renders exactly as it
always did — the widget falls back to the collapsible source list when `marker`
is absent.

`Citations.tsx` prefixes each entry with its marker when present and orders the
list by marker, so the list reads in the order the customer met the citations in
the text. One format, extended. Not two formats side by side.

## Negative case behaviour

With zero passages, there is **no context block at all** — not an empty one. An
empty "Retrieved passages:" header invites a best-effort guess under a heading
that implies sourcing. Instead the instruction says plainly that nothing was
retrieved and that the model must not state facts about the organization.

The prompt also distinguishes two different "I don't have that": the **knowledge
base** not covering a topic (say so, offer a human) versus the **customer's
account** not having something, which the integration tools report and which is a
definite factual answer to give directly.

## Measurement

### Prompt tokens fell 18.7%

The budget was "prompt tokens per turn must not rise".

| | Tokens |
| --- | --- |
| Before: passages as `search_kb` tool JSON | 1220 |
| After: numbered block + stripped tool payload | **992** |
| Delta | **−228 (−18.7%)** |
| If the tool payload were *not* stripped | 2203 (+80%) |

That last row is the important one. The passages initially appeared **twice** in
the finalize call — once as the tool result the agent loop reasoned over, once
as the block — which nearly doubled context for no benefit and gave the model two
representations of the same evidence, only one carrying the markers it was asked
to cite. The `search_kb` payload is now replaced by a pointer *for the finalize
call only*; the agent loop still sees full results, because that is what it
reasons over when deciding whether to search again.

Deduplication accounts for one passage of the saving; stripping the duplicate
payload accounts for the rest.

### Faithfulness and citation accuracy: not measured

**This is the headline metric for this prompt and it is unmeasured.** Both need
the LLM judge, and the OpenRouter balance is $0.19 against roughly $1.70 for a
before/after across the 45-case set at the measured $0.019/case.

Everything structural is asserted in tests — markers resolve, impossible markers
are stripped, passages are byte-identical, refusals are not penalised — but
whether the model *actually cites more faithfully* is a question about model
behaviour that only the judge answers. Run `pnpm eval:rag` with rerank on once
there is budget; faithfulness and citation accuracy are already in the harness.

## Testing

`apps/api/src/__tests__/grounded-prompting.test.ts`, 24 tests.

The persona and tone assertions are treated as a contract: grounding is an
addition, not a rewrite, so the suite asserts that "Match the customer's tone",
"you are an AI assistant", "Be concise", the safety boundaries and the escalation
policy all survive unchanged.
