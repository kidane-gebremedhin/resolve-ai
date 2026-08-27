// Reciprocal Rank Fusion.
//
// When a question is retrieved several ways (the rewritten form, each part of a
// multi-part question, each paraphrase) the result lists have to be combined
// into one. Fusing on SCORE does not work: cosine scores are not comparable
// across different query embeddings, so the query that happened to produce
// higher absolute numbers would dominate regardless of whether its results were
// better.
//
// RRF ignores scores entirely and fuses on RANK, which is comparable by
// construction. A passage ranked first by two different queries beats one ranked
// first by a single query, which is exactly the agreement signal wanted from
// multi-query retrieval.
import type { KbHit } from "../../kb/search.service.js";

/**
 * The rank-smoothing constant from the original RRF paper.
 *
 * It flattens the difference between the top few ranks: without it, rank 1
 * scores double rank 2 and a single query's favourite would outrank a passage
 * two other queries agreed on at rank 2.
 */
export const RRF_K = 60;

export type RankedList = { query: string; hits: KbHit[] };

export type FusedHit = KbHit & {
  /** The fused score. Not comparable to a cosine score, and never shown to the model. */
  rrfScore: number;
  /** Which queries retrieved this passage, for debugging a surprising ranking. */
  matchedQueries: string[];
};

/** Chunk identity. Falls back to `sourceId:chunkIndex` when no chunk id is carried. */
export function hitKey(hit: KbHit): string {
  const withId = hit as KbHit & { chunkId?: string };
  return withId.chunkId ?? `${hit.sourceId}:${hit.chunkIndex}`;
}

/**
 * Fuse several ranked lists into one, highest fused score first.
 *
 * Deduplicates by chunk id, keeping the highest-scoring copy of a passage so the
 * citation surface still shows a real cosine score rather than a fused one.
 */
export function reciprocalRankFusion(lists: readonly RankedList[], k = RRF_K): FusedHit[] {
  const byKey = new Map<string, FusedHit>();

  for (const list of lists) {
    list.hits.forEach((hit, index) => {
      const key = hitKey(hit);
      const contribution = 1 / (k + index + 1);
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, {
          ...hit,
          rrfScore: contribution,
          matchedQueries: [list.query],
        });
        return;
      }

      existing.rrfScore += contribution;
      if (!existing.matchedQueries.includes(list.query)) {
        existing.matchedQueries.push(list.query);
      }
      // Keep the best raw score seen for this passage: it is what the citation
      // panel and the knowledge-gap threshold read.
      if (hit.score > existing.score) existing.score = hit.score;
    });
  }

  return [...byKey.values()].sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    // Deterministic tie-break, so an unchanged corpus produces an unchanged
    // ranking and an eval diff means something.
    if (b.score !== a.score) return b.score - a.score;
    return hitKey(a).localeCompare(hitKey(b));
  });
}

/**
 * Single-list passthrough.
 *
 * With one query there is nothing to fuse, and running RRF anyway would replace
 * a meaningful cosine ordering with a rank-derived one for no benefit. The
 * common case stays untouched.
 */
export function singleList(query: string, hits: readonly KbHit[]): FusedHit[] {
  return hits.map((hit) => ({ ...hit, rrfScore: 0, matchedQueries: [query] }));
}
