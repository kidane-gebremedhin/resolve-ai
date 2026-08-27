// Fusing the dense and lexical result lists.
//
// The two legs produce scores on incomparable scales: cosine similarity is
// bounded in [-1, 1] and comparable within one query, while MongoDB's `$text`
// score is unbounded and corpus-relative. Averaging them directly is meaningless
// — whichever leg happens to produce larger numbers wins regardless of whether
// its results are better.
//
// So there are two strategies and RRF is the default:
//
// - **rrf** ignores scores entirely and fuses on RANK, which is comparable by
//   construction. This is correct without tuning, which is why it is the default.
// - **weighted** min-max normalises each list to [0, 1] first, then blends by
//   alpha. Normalisation is per-query and per-leg, so it is only meaningful
//   within a single query — but it makes alpha a real dial, which RRF's k
//   constant does not.
import type { KbHit } from "./search.service.js";

export type FusionStrategy = "rrf" | "weighted";

/** Rank-smoothing constant from the RRF paper; flattens the top few ranks. */
const RRF_K = 60;

export type LegResult = { leg: "dense" | "lexical"; hits: KbHit[] };

function keyOf(hit: KbHit): string {
  return hit.chunkId ?? `${hit.sourceId}:${hit.chunkIndex}`;
}

/** Min-max to [0, 1]. A list whose scores are all equal maps to 1: no signal, no penalty. */
function normalise(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === min) return scores.map(() => 1);
  return scores.map((s) => (s - min) / (max - min));
}

/**
 * Fuse the two legs.
 *
 * `alpha` weights dense against lexical: 1.0 is dense-only, 0.0 lexical-only.
 * It applies to both strategies — under RRF it scales each leg's rank
 * contribution, under `weighted` it blends the normalised scores — so a single
 * dial sweeps the whole space and the eval harness can pick the default from
 * the curve rather than from intuition.
 *
 * The returned `score` is always the DENSE cosine score where the passage had
 * one, because the score floor, the knowledge-gap threshold and the citation
 * panel all read it and none of them should ever see a fused number. Ordering
 * comes from the fusion; the score reported alongside does not.
 */
export function fuseHybrid(
  legs: readonly LegResult[],
  opts: { alpha: number; strategy: FusionStrategy; topK: number },
): KbHit[] {
  const { alpha, strategy, topK } = opts;
  const fused = new Map<string, { hit: KbHit; score: number; legs: Set<"dense" | "lexical"> }>();

  for (const { leg, hits } of legs) {
    const weight = leg === "dense" ? alpha : 1 - alpha;
    if (weight === 0) continue;

    const normalised = strategy === "weighted" ? normalise(hits.map((h) => h.score)) : [];

    hits.forEach((hit, index) => {
      const key = keyOf(hit);
      const contribution =
        strategy === "rrf"
          ? weight * (1 / (RRF_K + index + 1))
          : weight * (normalised[index] ?? 0);

      const existing = fused.get(key);
      if (!existing) {
        fused.set(key, { hit: { ...hit }, score: contribution, legs: new Set([leg]) });
        return;
      }
      existing.score += contribution;
      existing.legs.add(leg);
      // Keep the dense hit's own cosine score if this leg is the dense one; the
      // lexical leg's text score must never overwrite it.
      if (leg === "dense") existing.hit.score = hit.score;
      // The mirror carries the heading path; the dense leg may not.
      if (hit.headingPath?.length && !existing.hit.headingPath?.length) {
        existing.hit.headingPath = hit.headingPath;
      }
      if (hit.chunkId && !existing.hit.chunkId) existing.hit.chunkId = hit.chunkId;
    });
  }

  return [...fused.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Deterministic tie-break so an unchanged corpus ranks identically and an
      // eval diff means something.
      if (b.hit.score !== a.hit.score) return b.hit.score - a.hit.score;
      return keyOf(a.hit).localeCompare(keyOf(b.hit));
    })
    .slice(0, topK)
    .map((entry) => ({ ...entry.hit, retrievedBy: [...entry.legs] }));
}
