/**
 * Generation metrics.
 *
 * The scoring functions here are pure: they take a judge's structured verdicts
 * and turn them into numbers. The judge call itself lives in `judge.ts`, so
 * every function below is unit-testable without a model, which is the only way
 * a metric definition can be pinned down at all.
 */

// Faithfulness and the claim-verdict shape are defined with the judge that
// produces them (`@api/services/ai/eval/judge.js`), because the online sampler
// scores production turns with the same judge and the same metric. Re-exported
// here so every offline call site keeps importing its metrics from one module.
export {
  faithfulness,
  type ClaimJudgement,
  type ClaimVerdict,
} from "@api/services/ai/eval/judge.js";

import type { ClaimJudgement } from "@api/services/ai/eval/judge.js";

/** Every claim the context did not support, for the run output. */
export function unsupportedClaims(claims: readonly ClaimJudgement[]): ClaimJudgement[] {
  return claims.filter((c) => c.verdict !== "supported");
}

/**
 * Context precision: of the passages sent to the model, how many were needed.
 *
 * Measures wasted context budget. Distinct from Precision@K, which scores
 * retrieval against a case's declared relevant set; this scores the passages
 * that actually reached the prompt against the judge's view of what the answer
 * required.
 */
export function contextPrecision(usedCount: number, sentCount: number): number | null {
  if (sentCount <= 0) return null;
  return Math.min(usedCount, sentCount) / sentCount;
}

/**
 * Context recall: was all the evidence the reference answer needs present in
 * the passages the model was given.
 *
 * A low value here with high Recall@K means the passages were retrieved but
 * dropped before the prompt; a low value in both means retrieval missed them.
 */
export function contextRecall(coveredCount: number, requiredCount: number): number | null {
  if (requiredCount <= 0) return null;
  return Math.min(coveredCount, requiredCount) / requiredCount;
}

/**
 * Citation accuracy: of the citations the reply emitted, how many point at a
 * passage that actually supports the sentence they are attached to.
 *
 * A reply with no citations returns null rather than 0. Until grounded
 * prompting ships, most replies cite nothing, and scoring those as 0 would make
 * the metric read as a catastrophic failure of a feature that does not exist
 * yet.
 */
export function citationAccuracy(
  supportedCitations: number,
  totalCitations: number,
): number | null {
  if (totalCitations <= 0) return null;
  return supportedCitations / totalCitations;
}

/**
 * Refusal correctness, for negative cases only.
 *
 * The bar is deliberately two-part: the answer must decline AND the turn must
 * escalate. A bot that says "I'm not sure" and then leaves the customer sitting
 * there has not handled the case, it has only avoided lying about it.
 */
export function refusalCorrect(args: {
  declined: boolean;
  action: string;
}): boolean {
  return args.declined && args.action === "escalate";
}

/** Mean over the values that exist; null means "did not apply", never zero. */
export function meanOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/** Fraction of booleans that are true, or null when there are none. */
export function rateOf(values: readonly boolean[]): number | null {
  if (values.length === 0) return null;
  return values.filter(Boolean).length / values.length;
}
