# 44 — Contradictory Knowledge

## The problem

Real knowledge bases contradict themselves constantly: an old refund policy page
and a new one, two crawled pages quoting different prices, a help centre article
that outlived the product.

Both passages are relevant. Both clear the score floor. Both reach the prompt.
And relevance cannot separate them, because "most relevant to the question" and
"most likely to be correct" are different properties — the stale document often
scores *higher*, since it was written when the topic was fresher.

## What happened before (Part A findings)

Reproduced and kept permanently in `knowledge-conflict.test.ts`:

1. **Both contradictory passages reach the prompt.** Neither is filtered; both
   are highly relevant to "refund window", which is exactly what makes them
   dangerous.
2. **They are ranked by relevance alone.** In the seeded case the *stale*
   document scores higher (0.88 vs 0.86), so the model is handed the wrong
   answer first.
3. **The prompt said nothing about conflicts, recency or authority.** Not one
   line, before or after the P6 grounding rewrite.
4. **The metadata to disambiguate did not exist.** A chunk carried
   `organizationId`, `agentId`, `sourceId`, `chunkIndex`, `url`, `text`, and
   after P4 a `headingPath` and a mirror row. No `sourceUpdatedAt`, no priority,
   no version.

What the model does next is its own business, and that is the problem. Blending
is the worst outcome: a confident answer that exists in no document.

## Detection

**The reranker cannot detect a contradiction.** This is worth stating because
the obvious move is to reuse the scores already in hand. A cross-encoder scores
*relevance*, not *agreement* — two passages can both score 0.9 by both answering
the question, which is what a contradiction looks like and also exactly what a
well-covered topic looks like.

So scores are used as a **gate**, not as the detector:

1. `conflictPossible()` — pure comparison of scores already computed. True only
   when the top-K spans more than one source **and** the top two score within
   `KB_CONFLICT_SCORE_GAP` of each other. A source far below the leader is
   weaker evidence, not a competing claim.
2. Only if that passes, one small-model call asks the narrow question: do these
   disagree about *what was asked*.

The budget requirement — a single-source turn must not gain a call — is met
structurally: `conflictPossible` returns false for one source without touching a
model.

The check's prompt is deliberately narrow, because two documents covering
different aspects of a topic differ without contradicting, and a loose check
flags every well-covered topic. **Different is not contradictory.**

A failed check returns *no conflict*, never a conflict: "we do not know" must not
become "they disagree", or a provider hiccup escalates turns that were fine.

## Resolution

Fixed order, and the reasoning matters more than the order:

| Order | Signal | Why here |
| --- | --- | --- |
| 1 | **Priority** (operator-set) | The only signal a human set deliberately. An operator who marked the canonical policy authoritative has said something no heuristic should override |
| 2 | **`sourceUpdatedAt`** | Absent a human decision, the newer document is the better guess about current truth |
| 3 | **Relevance score** | Reluctantly, and only as a tiebreak. Relevance says which passage matches the *question*, not which is *correct* |

A source with **no** `sourceUpdatedAt` cannot win on recency: an unknown date is
not evidence of being current.

### The unbreakable tie

When two sources tie on all three, resolution returns `unresolved` and the model
is told to **escalate rather than choose**. This is the case the policy exists
for: picking one would be a coin flip presented as an answer, and a customer
acting on a refund window we cannot stand behind is worse than a handoff.

### The losing passages stay in the prompt

The winner's passages are moved to the front, but the loser's are not removed.
The model is told which is authoritative and told not to merge. Dropping the
other would hide from the operator that a contradiction exists at all.

## `sourceUpdatedAt` is not `updatedAt`

`updatedAt` moves on every reingest, retry and status change, so it says nothing
about which of two documents is more current — which is the only thing recency
resolution needs it for. `sourceUpdatedAt` moves only when `contentHash` does.

## Prompt behaviour

The search result carries a `conflict` object, and the system prompt has rules
for it:

- With an authoritative source: answer from **that source only**, cite it, do not
  blend, do not present both figures as though either could be right.
- Unresolved: do not pick, do not merge. Tell the customer the documentation is
  inconsistent and follow the escalation policy.

## Operator surface

Conflicts are recorded as `KnowledgeGap` with `kind: "conflict"`, carrying the
sources involved, how it was resolved, and which won.

They are a **separate kind** because they are a different problem with a
different fix: a gap is filled by writing a document, a conflict is fixed by
deciding which existing document is right and retiring or reprioritising the
other. Sharing one kind would bury conflicts inside a list of missing topics. The
unique index includes `kind`, so a gap and a conflict for the same query cannot
overwrite each other.

## Priority in the UI

An integer from −10 to 10 on the knowledge source detail page, bounded on purpose:
this is a coarse "which document do we stand behind" dial, not a score to tune.
An unbounded integer invites an ordering nobody remembers in six months.

Changing it does **not** reingest and does **not** move `sourceUpdatedAt` — it is
metadata, not content. It is mirrored onto the source's chunks immediately,
because retrieval reads it from there on the hot path.

## Backfill: metadata only, no re-embedding

**A metadata-only update sufficed. No reingest was needed and no vector was
re-embedded.**

The reason is P4: retrieval's source of truth for chunk text and metadata moved
from Pinecone into the `kbchunks` mirror, so conflict resolution reads `priority`
and `sourceUpdatedAt` from Mongo. `scripts/backfill-conflict-metadata.ts` is
therefore a Mongo update.

Had retrieval still read from Pinecone metadata, this would have required either
extending the client wrapper in `config/pinecone.ts` — which exposes only
`upsert`, `query` and `deleteMany`, with no metadata update — or a full re-embed
of every corpus. P4's mirror is what made this cheap.

Pinecone metadata *does* now receive both fields on new ingests, for consistency.
Old vectors do not carry them, and that is harmless: they are only the fallback
for deployments without a mirror, where resolution degrades to score-only.

`sourceUpdatedAt` is seeded from `lastSyncedAt`, falling back to `updatedAt`.
Both are approximations — the real content-change time was never recorded before
this — and the script says so rather than implying the dates are exact.
