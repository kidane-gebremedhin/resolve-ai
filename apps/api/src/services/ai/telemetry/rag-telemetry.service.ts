// Writes one `RagTurnMetric` per customer turn.
//
// THE CONSTRAINT THAT SHAPES THIS FILE: nothing in here may cost the customer a
// millisecond, and nothing in here may fail their reply. The runner calls
// `recordRagTurn` AFTER the reply has been persisted and emitted, and does not
// await it. Every path below is wrapped so a thrown error becomes a log line.
//
// `flushRagTelemetry` exists because "fire and forget" and "assertable" are
// otherwise in tension: a test that cannot await the write can only sleep and
// hope, and a process that exits mid-write loses the turn. In-flight writes are
// tracked so both can wait for them deliberately.

import mongoose from "mongoose";
import { RagTurnMetric } from "../../../models/index.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { maskPii } from "../../integrations/piiMask.js";
import type { UsageTotals } from "../../openrouter-usage.service.js";
import { retrievalConfidence, scoreSummary } from "../retrieval/retrieval-confidence.js";
import type { RetrievalStats } from "../retrieval/kb-retriever.js";
import type { GenerationStats, QueryRewriteRecord, ReplyAction } from "../graph/state.js";
import type { KbHit } from "../../kb/search.service.js";
import type { ContextCitation } from "../context-block.js";
import { maybeJudgeTurn } from "./online-faithfulness.service.js";

export type RagTurnInput = {
  organizationId: string;
  agentId: string;
  conversationId: string;
  messageId: string;
  /** The customer's message, used when the turn never ran a KB search. */
  customerMessage: string;
  queryRewrites: QueryRewriteRecord[];
  retrievalStats: RetrievalStats[];
  /** The passages that reached the prompt, after fusion and reranking. */
  kbHits: KbHit[];
  citations: ContextCitation[];
  generationStats?: GenerationStats;
  confidence: number;
  action: ReplyAction;
  toolTurns: number;
  conflicted: boolean;
  replyText: string;
  model: string;
  status: "ok" | "fallback";
  durationMs: number;
  /**
   * The in-flight usage call, if the turn made any generations. Awaited here so
   * the resolved tokens and cost land on the metric too — the alternative is a
   * second round trip to OpenRouter for numbers another task already fetched.
   */
  usage?: Promise<UsageTotals | null> | null;
};

/** In-flight telemetry writes, so tests and shutdown can wait for them. */
const inFlight = new Set<Promise<unknown>>();

function track(p: Promise<unknown>): void {
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p));
}

/** Wait for every telemetry write started so far. Never throws. */
export async function flushRagTelemetry(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}

/**
 * The turn's query, before and after rewriting.
 *
 * A turn that searched several times reports its FIRST search: that is the one
 * the customer's message produced, and the later ones are the agent refining its
 * own question. An operator reading a no-hit row wants the former. The rest of
 * the turn's searches stay reachable through the conversation.
 */
function queriesOf(input: RagTurnInput): { originalQuery: string; rewrittenQuery: string } {
  const first = input.queryRewrites[0];
  return {
    originalQuery: first?.originalQuery ?? input.customerMessage,
    rewrittenQuery: first?.rewrittenQuery ?? "",
  };
}

/**
 * The turn's ranked passages, each marked with whether the reply cited it.
 *
 * Deduplicated by chunk id, keeping the best rank: a passage retrieved twice by
 * two paraphrases of the same query is one passage, and counting it twice would
 * inflate its retrieval frequency for a reason that has nothing to do with the
 * passage.
 */
export function chunkRecords(
  kbHits: readonly KbHit[],
  citations: readonly ContextCitation[],
): {
  chunkId: string;
  sourceId: string;
  rank: number;
  score: number | null;
  rerankScore: number | null;
  cited: boolean;
}[] {
  const citedIds = new Set(
    citations.map((c) => c.chunkId).filter((id): id is string => Boolean(id)),
  );
  const seen = new Set<string>();
  const out: ReturnType<typeof chunkRecords> = [];

  kbHits.forEach((hit) => {
    const chunkId = hit.chunkId ?? `${hit.sourceId}:${hit.chunkIndex}`;
    if (seen.has(chunkId)) return;
    seen.add(chunkId);
    out.push({
      chunkId,
      sourceId: hit.sourceId,
      // Rank is the position in the DEDUPLICATED list, which is the list the
      // prompt actually saw.
      rank: out.length,
      score: typeof hit.score === "number" ? hit.score : null,
      rerankScore: typeof hit.rerankScore === "number" ? hit.rerankScore : null,
      cited: citedIds.has(chunkId),
    });
  });

  return out;
}

/** Build the document. Pure and exported so its shape can be unit-tested. */
export function buildRagTurnMetric(input: RagTurnInput): Record<string, unknown> {
  const { originalQuery, rewrittenQuery } = queriesOf(input);
  const scores = input.kbHits.map((h) => h.score);
  const summary = scoreSummary(scores);

  const stats = input.retrievalStats;
  const gen = input.generationStats;

  return {
    organizationId: new mongoose.Types.ObjectId(input.organizationId),
    agentId: new mongoose.Types.ObjectId(input.agentId),
    conversationId: new mongoose.Types.ObjectId(input.conversationId),
    messageId: new mongoose.Types.ObjectId(input.messageId),

    // Masked unconditionally, before anything else touches these strings. The
    // org's `piiRedaction` setting governs what reaches the MODEL; this store is
    // browsed by operators, and __specs/12 does not care which setting is on.
    originalQuery: maskPii(originalQuery),
    rewrittenQuery: maskPii(rewrittenQuery),

    retrieval: {
      // The final context size, not stage 1's widened candidate count — the two
      // are different settings for a reason (see __specs/42).
      topK: env.ai.kbSearchTopK,
      // The loosest floor actually applied this turn: it is 0 on any search that
      // fell through to the widen-on-empty retry, which is the fact worth
      // recording rather than the floor that was configured.
      minScore: stats.length > 0 ? Math.min(...stats.map((s) => s.minScore)) : env.ai.kbSearchMinScore,
      hitCount: input.kbHits.length,
      topScore: summary.topScore,
      meanScore: summary.meanScore,
      scoreSpread: summary.scoreSpread,
      retrievalConfidence: retrievalConfidence(scores),
      widenedOnEmpty: stats.some((s) => s.widenedOnEmpty),
      sourceIds: [...new Set(input.kbHits.map((h) => h.sourceId))],
      chunks: chunkRecords(input.kbHits, input.citations),
      latencyMs: stats.reduce((sum, s) => sum + s.latencyMs, 0),
      searchCount: stats.length,
    },

    generation: {
      confidence: input.confidence,
      action: input.action,
      citationCount: gen?.citationCount ?? input.citations.length,
      citedSourceIds: gen?.citedSourceIds ?? [...new Set(input.citations.map((c) => c.sourceId))],
      answerLength: gen?.answerLength ?? input.replyText.length,
      model: input.model,
      // Null, not zero: unresolved cost must read as unknown. Backfilled below
      // once the usage call returns.
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
      latencyMs: gen?.latencyMs ?? 0,
    },

    flags: {
      noHits: input.kbHits.length === 0,
      lowConfidence: input.confidence < env.ai.confidenceThreshold,
      escalated: input.action === "escalate",
      conflicted: input.conflicted,
    },

    toolTurns: input.toolTurns,
    status: input.status,
    durationMs: input.durationMs,
  };
}

/**
 * Persist the turn's telemetry, then backfill cost and (sampled) faithfulness.
 *
 * Returns nothing and never rejects. The caller does not await it.
 */
export function recordRagTurn(input: RagTurnInput): void {
  if (!env.rag.telemetryEnabled) return;
  track(persist(input));
}

async function persist(input: RagTurnInput): Promise<void> {
  let metricId: mongoose.Types.ObjectId | null = null;

  try {
    const doc = await RagTurnMetric.create(buildRagTurnMetric(input));
    metricId = doc._id as mongoose.Types.ObjectId;
  } catch (err) {
    // The whole point of this module is that this line is the worst thing that
    // can happen when telemetry breaks.
    logger.warn("[rag-telemetry] metric write failed", { err: (err as Error).message });
    return;
  }

  await Promise.allSettled([
    backfillUsage(metricId, input.usage),
    maybeJudgeTurn({
      metricId,
      organizationId: input.organizationId,
      question: queriesOf(input).originalQuery,
      answer: input.replyText,
      passages: input.kbHits,
    }),
  ]);
}

/** Attach resolved tokens and cost once OpenRouter has priced the generations. */
async function backfillUsage(
  metricId: mongoose.Types.ObjectId,
  usage: Promise<UsageTotals | null> | null | undefined,
): Promise<void> {
  if (!usage) return;
  try {
    const totals = await usage;
    if (!totals) return;
    await RagTurnMetric.updateOne(
      { _id: metricId },
      {
        $set: {
          "generation.promptTokens": totals.promptTokens,
          "generation.completionTokens": totals.completionTokens,
          "generation.costUsd": totals.costUsd,
        },
      },
    );
  } catch (err) {
    logger.warn("[rag-telemetry] usage backfill failed", { err: (err as Error).message });
  }
}
