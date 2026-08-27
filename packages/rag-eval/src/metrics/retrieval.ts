/**
 * Retrieval metrics, computed over a ranked list of chunk ids against the set a
 * case declares as relevant.
 *
 * Every function here is pure and takes the ranked list already truncated by the
 * caller's K, so the definitions below are the only place K means anything. That
 * matters because these four metrics disagree about what K does: Recall@K asks
 * whether the evidence is anywhere in the window, Precision@K divides by the
 * window size, MRR ignores the window past the first hit, and nDCG discounts by
 * position within it. Conflating them produces numbers that look plausible and
 * move for the wrong reasons.
 */

/** A ranked retrieval result, most relevant first. */
export type RankedItem = { id: string; score: number };

function relevantSet(relevantIds: readonly string[]): Set<string> {
  return new Set(relevantIds);
}

/**
 * Recall@K: did the required evidence appear anywhere in the top K?
 *
 * Fraction of the relevant set that was retrieved, not a 0/1 hit: a case that
 * needs two sources and finds one scores 0.5. Multi-hop cases are the whole
 * reason this is graded rather than binary.
 *
 * A case with no relevant ids (a negative case) has nothing to recall, so it
 * returns null and is excluded from the mean rather than counted as 0 or 1.
 * Scoring negatives as 0 would drag the average down for correct behavior;
 * scoring them 1 would hide real misses.
 */
export function recallAtK(
  ranked: readonly RankedItem[],
  relevantIds: readonly string[],
  k: number,
): number | null {
  if (relevantIds.length === 0) return null;
  const relevant = relevantSet(relevantIds);
  const found = new Set(
    ranked
      .slice(0, k)
      .map((r) => r.id)
      .filter((id) => relevant.has(id)),
  );
  return found.size / relevant.size;
}

/**
 * Precision@K: of the K passages retrieved, how many were relevant.
 *
 * Divides by K, not by the number actually returned. Retrieving 2 passages when
 * K is 5 and both are relevant is Precision@5 = 0.4, not 1.0, because the
 * question is how much of the context budget was spent usefully.
 */
export function precisionAtK(
  ranked: readonly RankedItem[],
  relevantIds: readonly string[],
  k: number,
): number | null {
  if (relevantIds.length === 0) return null;
  if (k <= 0) return null;
  const relevant = relevantSet(relevantIds);
  const hits = ranked.slice(0, k).filter((r) => relevant.has(r.id)).length;
  return hits / k;
}

/**
 * Reciprocal rank: 1 / (position of the first relevant passage), 1-indexed.
 *
 * Zero when nothing relevant was retrieved at all. Averaged across cases this
 * is MRR; the mean is taken by the caller so a single case's value stays
 * inspectable in the report.
 */
export function reciprocalRank(
  ranked: readonly RankedItem[],
  relevantIds: readonly string[],
): number | null {
  if (relevantIds.length === 0) return null;
  const relevant = relevantSet(relevantIds);
  const idx = ranked.findIndex((r) => relevant.has(r.id));
  return idx === -1 ? 0 : 1 / (idx + 1);
}

/**
 * nDCG@K with binary gains.
 *
 * DCG uses the standard log2(rank + 1) discount. The ideal DCG places every
 * relevant passage at the top, capped at K: a case with three relevant chunks
 * evaluated at K=2 can only ever reach the ideal for two of them, and dividing
 * by an uncapped ideal would make a perfect ranking score below 1.
 *
 * This is the metric that separates "found it at rank 1" from "found it at rank
 * 5", which Recall@5 cannot see and Precision@5 only sees in aggregate.
 */
export function ndcgAtK(
  ranked: readonly RankedItem[],
  relevantIds: readonly string[],
  k: number,
): number | null {
  if (relevantIds.length === 0) return null;
  if (k <= 0) return null;
  const relevant = relevantSet(relevantIds);

  const dcg = ranked
    .slice(0, k)
    .reduce((sum, r, i) => (relevant.has(r.id) ? sum + 1 / Math.log2(i + 2) : sum), 0);

  const idealCount = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) idcg += 1 / Math.log2(i + 2);

  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Mean of the values that exist, ignoring nulls.
 *
 * Null means "this metric does not apply to this case" (a negative case has no
 * relevant set), which is different from zero. Averaging nulls as zero is the
 * single easiest way to make a retrieval change look worse than it is.
 */
export function meanOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}
