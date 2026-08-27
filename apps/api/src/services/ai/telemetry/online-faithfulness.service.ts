// Sampled online faithfulness: the P2 judge, pointed at real production turns.
//
// Offline faithfulness (__specs/39) scores a golden set that stops being
// representative the moment an operator uploads a document. This scores the
// questions customers actually asked against the knowledge base the org
// actually has — the only measurement that stays true as both drift.
//
// Three constraints, and each one decides part of the design:
//
//   ZERO REPLY LATENCY. Called from the telemetry write, which itself runs after
//   the reply is persisted and emitted. The judge call is never on any path a
//   customer waits on.
//
//   SAMPLED, NOT COMPLETE. Judging every turn would roughly double the LLM bill
//   to produce a number that is a trend line either way. Five percent moves a
//   rolling average within a day at a few hundred turns.
//
//   BUDGET-GATED. An org already over its monthly AI budget has its replies
//   paused; spending more of its money on measurement would be perverse. The
//   same `orgBudgetStatus` gate the rest of the AI surface uses applies here.

import type mongoose from "mongoose";
import { RagTurnMetric } from "../../../models/index.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { maskPii } from "../../integrations/piiMask.js";
import { orgBudgetStatus } from "../../budget-alert.service.js";
import { faithfulness, runJudge, type JudgePassage } from "../eval/judge.js";
import type { KbHit } from "../../kb/search.service.js";

/** Injected in tests; production uses `Math.random`. */
export type SampleDecider = () => number;

/**
 * Whether this turn is drawn for judging.
 *
 * A rate of 0 disables sampling without disabling telemetry, and a rate of 1
 * judges everything — useful for a short deliberate measurement window, not as
 * a steady state.
 */
export function shouldSample(rate: number, random: SampleDecider = Math.random): boolean {
  if (!(rate > 0)) return false;
  if (rate >= 1) return true;
  return random() < rate;
}

/** Passages exactly as the reply saw them, numbered the same way. */
function toJudgePassages(hits: readonly KbHit[]): JudgePassage[] {
  return hits.map((h) => ({
    id: h.chunkId ?? `${h.sourceId}:${h.chunkIndex}`,
    title: h.sourceTitle,
    text: h.text,
  }));
}

/** Record why a drawn turn produced no score, so "sampled" never means "1.0". */
async function markSkipped(
  metricId: mongoose.Types.ObjectId,
  reason: string,
): Promise<void> {
  await RagTurnMetric.updateOne(
    { _id: metricId },
    { $set: { "faithfulness.sampled": true, "faithfulness.skippedReason": reason } },
  );
}

/**
 * Roll the dice, and if the turn is drawn, judge it and write the score back.
 *
 * Never throws and never returns a value the caller acts on: a judge outage must
 * leave the metric exactly as it was written, minus a score.
 */
export async function maybeJudgeTurn(args: {
  metricId: mongoose.Types.ObjectId;
  organizationId: string;
  question: string;
  answer: string;
  passages: readonly KbHit[];
  random?: SampleDecider;
}): Promise<void> {
  try {
    if (!shouldSample(env.rag.faithfulnessSampleRate, args.random)) return;

    // Nothing to judge against. A reply with no retrieved passages cannot be
    // scored for faithfulness to them — that turn's story is already told by
    // `flags.noHits`, and running the judge would only produce a guaranteed 0
    // that drags the average down for a reason unrelated to grounding.
    if (args.passages.length === 0) {
      await markSkipped(args.metricId, "no_passages");
      return;
    }

    const budget = await orgBudgetStatus(args.organizationId);
    if (budget.exceeded) {
      await markSkipped(args.metricId, "budget_exceeded");
      return;
    }

    const judgeModel = env.rag.faithfulnessJudgeModel;
    const { verdict } = await withTimeout(
      runJudge({
        model: judgeModel,
        question: args.question,
        answer: args.answer,
        passages: toJudgePassages(args.passages),
      }),
      env.rag.faithfulnessTimeoutMs,
    );

    const score = faithfulness(verdict.claims);

    await RagTurnMetric.updateOne(
      { _id: args.metricId },
      {
        $set: {
          "faithfulness.sampled": true,
          "faithfulness.score": score,
          "faithfulness.claimCount": verdict.claims.length,
          // The unsupported claims are sentences lifted out of the reply, so
          // they can carry back whatever the customer put into the conversation.
          // Masked like every other string this collection stores.
          "faithfulness.unsupported": verdict.claims
            .filter((c) => c.verdict !== "supported")
            .slice(0, 10)
            .map((c) => ({
              claim: maskPii(c.claim ?? ""),
              verdict: c.verdict,
              reason: maskPii(c.reason ?? ""),
            })),
          "faithfulness.judgeModel": judgeModel,
          "faithfulness.judgedAt": new Date(),
          // A drawn turn whose answer made no factual claims is a real outcome,
          // not a failure: `score` is null and there is no skip reason.
          "faithfulness.skippedReason": score === null ? "no_claims" : null,
        },
      },
    );

    logger.info("[rag-telemetry] online faithfulness", {
      metricId: args.metricId.toString(),
      score,
      claims: verdict.claims.length,
      judgeModel,
    });
  } catch (err) {
    logger.warn("[rag-telemetry] faithfulness judging failed", {
      err: (err as Error).message,
    });
    await markSkipped(args.metricId, "judge_error").catch(() => undefined);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`judge timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}
