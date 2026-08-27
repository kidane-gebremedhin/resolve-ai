// Retrieval confidence: one normalised number for "did retrieval actually find
// the answer", derived rather than read off a raw score.
//
// A raw cosine score cannot answer that on its own. It is not comparable across
// queries — 0.42 is an excellent match for one question and noise for the next —
// which is the same property that makes a fixed `AI_KB_SEARCH_MIN_SCORE` always
// either too tight or too loose (see __specs/42). So instead of trusting the
// magnitude alone, this combines three signals that fail in different ways:
//
//   magnitude  how good the best passage looks in absolute terms
//   margin     how far clear of the runner-up it is, RELATIVE to itself, which
//              makes it scale-free: a decisive win reads the same whether the
//              scores are 0.9/0.2 or 0.09/0.02
//   depth      whether anything corroborates it, capped quickly — the third
//              passage is worth far less than the second, and the tenth nothing
//
// The weights are a convex combination, so the output is [0,1] by construction
// and every term is directly interpretable as "how much of the confidence came
// from where". They are tuned, not measured: this is a monitoring signal, and
// __specs/39 records the reasoning and the boundary cases.
//
// THIS DOES NOT REPLACE ANY THRESHOLD. `AI_KB_SEARCH_MIN_SCORE`,
// `KB_RERANK_MIN_SCORE` and `AI_CONFIDENCE_THRESHOLD` all keep behaving exactly
// as before; this number is emitted alongside the raw scores and nothing routes
// on it. Making it a control before it has been watched in production would be
// shipping an untested escalation policy.

/** Weight on the best passage's absolute score. */
export const W_MAGNITUDE = 0.6;
/** Weight on the rank-1 / rank-2 separation. */
export const W_MARGIN = 0.25;
/** Weight on corroboration by further passages. */
export const W_DEPTH = 0.15;

/** Passages past this add nothing: depth saturates at three. */
export const DEPTH_SATURATION = 3;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export type RetrievalConfidenceParts = {
  confidence: number;
  magnitude: number;
  margin: number;
  depth: number;
};

/**
 * Confidence in [0,1] from the raw scores of the passages that reached the
 * prompt. Order does not matter: scores are sorted here, because after RRF the
 * list is ordered by fused rank and its raw scores are not monotonic.
 *
 * The two boundary cases are decided, not incidental:
 *
 * ZERO HITS returns exactly 0, short-circuited before the formula. Retrieval
 * found nothing, so there is no evidence to be confident about, and letting the
 * depth and margin terms contribute a floor would make "found nothing" score
 * higher than "found one weak passage".
 *
 * ONE HIT gets a full margin term. There is no runner-up to separate from, and
 * both alternatives are wrong: scoring the margin 0 punishes a single decisive
 * source (the common shape of a good answer in a small knowledge base), while
 * scoring depth full would let one weak passage read as a corroborated answer.
 * So margin is full and depth is 1/3, which puts a strong lone hit high but
 * below a corroborated one, and leaves a weak lone hit low because the
 * magnitude term carries 60 percent of the weight.
 */
export function retrievalConfidence(scores: readonly number[]): number {
  return retrievalConfidenceParts(scores).confidence;
}

/** The same computation, with the terms exposed for telemetry and tests. */
export function retrievalConfidenceParts(scores: readonly number[]): RetrievalConfidenceParts {
  if (scores.length === 0) {
    return { confidence: 0, magnitude: 0, margin: 0, depth: 0 };
  }

  const sorted = [...scores].sort((a, b) => b - a);
  const top = sorted[0]!;

  const magnitude = clamp01(top);

  // A non-positive top score means the ranking carries no usable magnitude, so
  // the relative gap is undefined rather than large. Fall back to 0 instead of
  // dividing by it.
  const runnerUp = sorted[1];
  const margin =
    runnerUp === undefined ? 1 : top > 0 ? clamp01((top - runnerUp) / top) : 0;

  const depth = Math.min(sorted.length, DEPTH_SATURATION) / DEPTH_SATURATION;

  const confidence = clamp01(
    W_MAGNITUDE * magnitude + W_MARGIN * margin + W_DEPTH * depth,
  );
  return { confidence, magnitude, margin, depth };
}

/** Score distribution for the telemetry record. Null where there are no hits. */
export function scoreSummary(scores: readonly number[]): {
  topScore: number | null;
  meanScore: number | null;
  scoreSpread: number | null;
} {
  if (scores.length === 0) return { topScore: null, meanScore: null, scoreSpread: null };
  const sorted = [...scores].sort((a, b) => b - a);
  const top = sorted[0]!;
  const bottom = sorted[sorted.length - 1]!;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { topScore: top, meanScore: mean, scoreSpread: top - bottom };
}
