# 41 — Hybrid Retrieval

## Overview

Dense vectors find passages that **mean** the same thing. They are poor at
passages that **contain** the same rare token: an embedding of `ERR_4021` is not
meaningfully near a passage containing it, because the token is rare precisely
in proportion to how little distributional meaning it carries. Order ids, error
codes, SKUs, policy clause numbers and product names are exactly what customers
paste verbatim, and exactly what dense retrieval is worst at.

So retrieval now has two legs, run in parallel and fused.

Four separable changes shipped on one backfill, and the measurement section
attributes each one separately because that was the whole point of doing them
together.

## The lexical index: why Mongo `$text`

Three options were on the table.

**(a) MongoDB over a new `KbChunk` collection — chosen.** The repo already runs
Mongo. It also fixes a standing smell: chunk text lived *only* in Pinecone
metadata, truncated at 8000 characters, and retrieval read it from there. A
vector store is an index, not a database — no transactions, a metadata size
ceiling, and a reindex loses anything stored only there.

**(b) Pinecone sparse-dense hybrid — not available.** The account's index is
`dimension: 1536, metric: cosine, serverless`, a dense index. Sparse vectors
require a sparse-enabled index, so this would mean creating and backfilling a
new one. That is a larger and more disruptive change than (a), for a capability
(a) already provides.

**(c) In-process BM25 — rejected.** It requires holding the corpus in the API
process, which does not survive a large knowledge base and turns a memory
question into an availability question.

### `$text`, not Atlas Search

`$text` is portable: it works on the `mongo:7` container used for local
development and CI as well as on Atlas. Atlas Search would give better relevance
(real BM25, configurable analyzers, per-field weights, no single-index-per-
collection limit) but exists only on Atlas, which would make the lexical leg
untestable outside production.

`lexicalSearch()` is therefore written behind a narrow interface — query in,
ranked `KbHit[]` out — so an Atlas deployment can swap the implementation without
touching a caller. **This is the weakest part of the design and it is a
deliberate trade**: `$text` stems and stopwords in ways a support corpus does not
always want, and it has no per-field boosting beyond the single weighted index.

## `KbChunk`: the mirror

One row per chunk, written during ingestion, holding the untruncated text, the
heading path, the URL and a rough token count. `chunkId` is `<sourceId>:<index>`,
identical to the Pinecone vector id, which is what lets the two legs be fused
without a join.

The text index is `{ text: "text", headingPath: "text" }` weighted 1 and 3. A
single text index per collection is a MongoDB limit, so the heading path is
folded into it rather than indexed separately: a heading match is a strong signal
("Refunds" as a heading beats "refunds" mentioned in passing) but the body is
where the facts are.

**Retrieval reads passage text from here, not from Pinecone.** The metadata copy
survives as a fallback so a deployment whose mirror has not been backfilled
degrades to the old behaviour rather than returning empty passages.

Deleting a source deletes its chunks. Leaving them would keep a deleted document
lexically retrievable, which is a knowledge leak with extra steps.

## Fusion

The two legs produce scores on incomparable scales. Cosine is bounded in
[-1, 1] and comparable within one query; MongoDB's `$text` score is unbounded and
corpus-relative. Averaging them lets whichever leg happens to produce larger
numbers win regardless of relevance.

Two strategies, `KB_HYBRID_FUSION`:

- **`rrf`** (default) ignores scores and fuses on **rank**, which is comparable
  by construction: `Σ weight / (60 + rank)`. Correct without tuning.
- **`weighted`** min-max normalises each leg to [0, 1] first, then blends by
  alpha. Only meaningful within a single query, but it makes alpha a real dial.

`KB_HYBRID_ALPHA` weights dense against lexical under both strategies, so one
knob sweeps the whole space.

**The reported `score` is always the dense cosine score** where the passage had
one. The score floor, the knowledge-gap threshold and the citation panel all read
it, and none of them should ever see a fused or unbounded number. Fusion decides
*order*; it does not decide the number reported alongside.

The score floor (`AI_KB_SEARCH_MIN_SCORE`) is applied to the **dense leg only**.
It is a cosine threshold, and applying it to a `$text` score would drop every
lexical hit or none, depending entirely on the corpus.

## Tenancy

The lexical leg is a second query path into customer knowledge, so it carries
the same guard as `searchKb`, **duplicated rather than shared**: a guard that
lives somewhere else is a guard that gets forgotten when a third path is added.

- Every query is AND-scoped to `organizationId` **and** `agentId`.
- A missing `agentId` **refuses** rather than widening to the org.
- A missing `organizationId` refuses.

`rls.test.ts` covers all three, including the subtler boundary: a sibling agent
inside the same paying tenant.

## Degradation

The lexical leg is an enhancement. Losing it degrades retrieval to exactly what
it was before hybrid shipped, which is a working system; letting it throw would
take the reply down for an optimisation.

- Throws → logged, dense-only.
- Exceeds `KB_LEXICAL_TIMEOUT_MS` → logged, dense-only.
- `KB_HYBRID_ALPHA = 1.0` → never runs at all.

Both failure paths are asserted, with alpha forced inside the test: at the
default the leg would not run and the assertions would pass vacuously.

## Structure-aware chunking

Two bounded repairs on the existing chunker, both operating on boundaries
already present in the markdown. No semantic breakpoints, no
embedding-similarity splitting, no markdown parser, no new dependency, no change
to the target chunk size.

### Boundary repair

The 1200-character window can cut through a **table**, a **fenced code block** or
a **list group**. A table cut after its divider leaves a header with no rows and
rows with no header; half a code block is valid to nobody.

A cut landing inside one of those moves to the structure's **start**, so the
whole structure travels into the next chunk intact. Cutting at the structure's
*end* would be the alternative and would grow the current chunk by however long
the structure is — a 40-row table would blow the target size entirely.

Text containing no protected structures comes back **byte-identical** to the
previous chunker. This is asserted against an inlined copy of the old algorithm
rather than described, because if it were false every chunk id in every
customer's index would shift and a no-op backfill would re-embed the world.

### Heading path

Each chunk records the heading stack above it — `["Billing", "Refunds", "EU"]` —
and `KB_HEADING_PATH_EMBEDDING` prepends it to the **embedded** text. The stored
text stays clean, so a citation shows the passage rather than our annotation of
it.

The path is taken at the chunk's **midpoint**, not its start. Overlap drags a
chunk's start backwards across a heading boundary, so a chunk that is almost
entirely one section's content would be labelled with the previous one — and
that wrong label is then embedded with the text, which is worse than no label.
This was found by a test failing, not by inspection.

## Measurement

Eval harness (`pnpm eval:rag --retrieval-only`) over the 45-case fixture set.

### Alpha sweep: the default is measured, not chosen

| alpha | Recall@3 | Recall@5 | MRR | nDCG@3 |
| --- | --- | --- | --- | --- |
| 1.0 (dense only) | 0.905 | 0.973 | 0.856 | 0.852 |
| **0.7** | **0.959** | **1.000** | **0.912** | **0.910** |
| 0.5 | 0.959 | 1.000 | 0.899 | 0.900 |
| 0.3 | 0.946 | 1.000 | 0.872 | 0.869 |
| 0.0 (lexical only) | 0.919 | 1.000 | 0.824 | 0.824 |

An inverted U: **both extremes score worse than the blend**, which is what
genuine fusion looks like rather than one leg quietly dominating. 0.7 wins on
every metric and is the default.

### Attribution: four changes, four numbers

| Change | Metric moved | Verdict |
| --- | --- | --- |
| **Lexical leg** (alpha 1.0 → 0.7) | Recall@5 0.973 → 1.000, MRR 0.856 → 0.912 | The largest single contribution |
| **Heading paths** (off → on, at alpha 0.7) | Recall@3 0.932 → 0.959, MRR 0.892 → 0.912 | Real and cheap |
| **Boundary repair** | **0 of 6 chunks changed (0.0% of the corpus)** | No effect on this corpus, see below |
| **Embedding model** | 3-large @1536: Recall@3 0.959 → 1.000, MRR 0.912 → 0.923 | Wins, and is not the default, see below |

**Boundary repair contributed nothing measurable, and that is a finding rather
than a failure.** `scripts/analyze-chunk-repair.ts` re-chunks every source with
both algorithms: only 1 of 5 fixture documents contains a protected structure at
all, and its table does not straddle the one cut point in a 2-chunk document. The
repair is proven correct by a unit fixture built to straddle boundaries, and has
had zero effect on any real document available here. On a corpus of long
documents with many tables it would do more; on this one it did nothing, and the
changelog says so.

### Embedding models

All three candidates emit 1536 dimensions and so fit the existing index (3-large
via `dimensions: 1536`, which the provider honours).

| Model | Recall@3 | Recall@5 | MRR | Cost / 1M |
| --- | --- | --- | --- | --- |
| **`text-embedding-3-large` @1536** | **1.000** | 1.000 | **0.923** | $0.13 |
| `text-embedding-3-small` (incumbent) | 0.959 | 1.000 | 0.912 | $0.02 |
| `text-embedding-ada-002` | 0.973 | 1.000 | 0.872 | $0.10 |

**3-large wins and is deliberately not the default.** Changing the embedding
model invalidates every existing vector: an index holding vectors from two models
is an index returning nonsense, because cosine distance between two different
embedding spaces means nothing. A deployment that pulled a changed default and
restarted would begin embedding *queries* with one model against *documents*
embedded with another, and retrieval would silently degrade to noise with no
error anywhere.

So the switch is an explicit opt-in that must happen together with a full
`pnpm kb:reembed --all`, never by config alone. The gain is real but modest
(+0.041 Recall@3, +0.011 MRR) against 6.5x the embedding cost, which makes it a
decision about corpus size and budget rather than an obvious upgrade.

## Backfill

`pnpm kb:reembed` — the script that already re-ingested sources, extended rather
than duplicated. Re-ingesting rebuilds chunks, vectors and mirror rows in one
pass through the real pipeline, so there is deliberately no second script.

```bash
pnpm --filter @csb/api exec tsx scripts/reembed.ts --all --dry-run   # cost + delta, writes nothing
pnpm --filter @csb/api exec tsx scripts/reembed.ts --all             # backfill
pnpm --filter @csb/api exec tsx scripts/reembed.ts --all --resume    # continue an interrupted run
```

**Resumability is by observed state, not a checkpoint file:** `--resume` skips
any source whose mirror row count already equals its chunk count. An interrupted
run is restarted with the same command, and there is no cursor to go stale if the
corpus changed underneath it.

The dry run prices the whole run before it writes a single vector, using the same
4-chars-per-token estimate the chunker uses. It is an order-of-magnitude check
before spending, not an invoice, and says so.
