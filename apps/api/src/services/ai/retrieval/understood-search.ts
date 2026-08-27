// The retrieval path with query understanding in front of it.
//
// One function, because the pieces only make sense together: rewriting decides
// what to embed, multi-query retrieval runs those strings, RRF fuses the
// results, and the optional follow-up round uses what came back to write one
// more query. Splitting them would mean threading the same plan through four
// call sites.
//
// The whole thing degrades to exactly what happened before it existed: one
// `searchKb` call with the model's own query.
import type { KbHit } from "../../kb/search.service.js";
import type { KnowledgeBaseRetriever } from "./kb-retriever.js";
import type { QueryRewriteRecord } from "../graph/state.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { reciprocalRankFusion, singleList, type FusedHit, type RankedList } from "./fusion.js";
import { rerankHits, type Reranker } from "./rerank.js";
import {
  candidatesFromHits,
  checkForConflict,
  conflictPossible,
  orderByAuthority,
  resolveConflict,
  type ConflictDeps,
  type ConflictResolution,
} from "../../kb/conflict.js";
import {
  generateHypotheticalAnswer,
  planQueries,
  proposeFollowUpQuery,
  rawPlan,
  rewriteQuery,
  type ConversationTurn,
  type RewriteDeps,
} from "./query-rewrite.js";

export type UnderstoodSearchResult = {
  hits: FusedHit[];
  record: QueryRewriteRecord;
  /** True when every candidate scored below the calibrated relevance floor. */
  noRelevantEvidence: boolean;
  /** Set when the top sources were found to contradict each other. */
  conflict: {
    conflicted: boolean;
    reason: string;
    resolution: ConflictResolution | null;
  };
};

export async function understoodSearch(
  args: {
    query: string;
    conversationId: string;
    retriever: Pick<KnowledgeBaseRetriever, "searchHits">;
    history?: ConversationTurn[];
    vocabulary?: string[];
    /** Final context size. Stage 1 always widens beyond this. */
    topK?: number;
    /** Injected so tests can drive stage 2 without a network call. */
    reranker?: Reranker | null;
    /** Injected for the same reason, for the contradiction check's model call. */
    conflictDeps?: ConflictDeps;
  },
  deps: RewriteDeps = {},
): Promise<UnderstoodSearchResult> {
  const started = Date.now();

  const plan = env.ai.queryRewriteEnabled
    ? await rewriteQuery(
        {
          query: args.query,
          conversationId: args.conversationId,
          history: args.history ?? [],
          vocabulary: args.vocabulary ?? [],
        },
        deps,
      )
    : rawPlan(args.query, "rewrite disabled");

  // HyDE replaces the embedded string rather than adding to it: embedding both
  // the question and a hypothetical answer for the same information need just
  // pays twice for one lookup.
  if (env.ai.queryHydeEnabled) {
    plan.hypotheticalAnswer = await generateHypotheticalAnswer(plan.rewrittenQuery, deps);
  }

  const queries = planQueries(plan);

  // ---- Stage 1: widen for recall ----
  //
  // Fetch far more than the prompt will hold. `AI_KB_SEARCH_TOP_K` used to serve
  // as both the candidate count and the final context size, which meant widening
  // the search also widened the prompt — the two concerns are now separate
  // settings. When reranking is off this collapses back to the old behaviour.
  const stage1K = env.kb.rerankEnabled ? env.kb.rerankCandidates : undefined;

  // The single-query case is the common one and stays a single call with no
  // fusion, so nothing about it got slower or reordered.
  let lists: RankedList[];
  if (queries.length === 1) {
    lists = [{ query: queries[0]!, hits: await args.retriever.searchHits(queries[0]!, stage1K) }];
  } else {
    lists = await Promise.all(
      queries.map(async (q) => ({ query: q, hits: await args.retriever.searchHits(q, stage1K) })),
    );
  }

  let fused: FusedHit[] =
    lists.length === 1 ? singleList(lists[0]!.query, lists[0]!.hits) : reciprocalRankFusion(lists);

  // One extra round, at most, ever. For a multi-hop question the second query
  // cannot be written until the first round's results name its subject.
  let followUpRan = false;
  if (env.ai.queryFollowUpRoundEnabled) {
    const followUp = await proposeFollowUpQuery(
      {
        originalQuery: plan.rewrittenQuery,
        queriesRun: queries,
        passages: fused.map((h) => ({ title: h.sourceTitle, text: h.text })),
      },
      deps,
    );
    if (followUp) {
      followUpRan = true;
      const extra = await args.retriever.searchHits(followUp, stage1K);
      queries.push(followUp);
      fused = reciprocalRankFusion([...lists, { query: followUp, hits: extra }]);
      logger.info("[ai] retrieval follow-up round", {
        conversationId: args.conversationId,
        followUp,
        added: extra.length,
      });
    }
  }

  // ---- Stage 2: rerank the wide candidate set down to the context size ----
  //
  // Stage 1 optimised recall and deliberately over-fetched. A cross-encoder now
  // reads the query and each passage TOGETHER — which a bi-encoder never does —
  // and cuts the pool to what actually answers the question.
  const topK = args.topK ?? env.ai.kbSearchTopK;
  const reranked = await rerankHits(
    {
      query: plan.rewrittenQuery,
      candidates: fused,
      topK,
      keyOf: (h) => h.chunkId ?? `${h.sourceId}:${h.chunkIndex}`,
    },
    args.reranker,
  );

  // ---- Contradicting sources ----
  //
  // Gated hard. `conflictPossible` is a pure comparison of scores already in
  // hand, so the common single-source turn never reaches the model call behind
  // it. Detection is a separate question from relevance: the reranker tells us
  // two passages both answer the question, never whether they agree.
  let conflicted = false;
  let conflictReason = "";
  let resolution: ConflictResolution | null = null;
  let hits = reranked.hits;

  if (env.kb.conflictDetectionEnabled && hits.length > 1) {
    const candidates = candidatesFromHits(hits);
    if (conflictPossible(candidates)) {
      const check = await checkForConflict(
        { query: plan.rewrittenQuery, candidates },
        args.conflictDeps ?? {},
      );
      if (check.conflicted) {
        conflicted = true;
        conflictReason = check.reason;
        resolution = resolveConflict(candidates);
        // The losing source's passages stay in the prompt. The model is told
        // which one is authoritative and told not to merge; removing the other
        // would hide from the operator that a contradiction exists at all.
        hits = orderByAuthority(hits, resolution) as typeof hits;
        logger.warn("[kb] contradictory sources", {
          conversationId: args.conversationId,
          reason: check.reason,
          resolvedBy: resolution.resolvedBy,
          winner: resolution.winner?.sourceTitle ?? null,
          sources: candidates.map((c) => c.sourceTitle),
        });
      }
    }
  }

  const record: QueryRewriteRecord = {
    originalQuery: plan.originalQuery,
    rewrittenQuery: plan.rewrittenQuery,
    queriesRun: queries,
    rewritten: plan.rewritten,
    followUpRan,
    reason: plan.reason,
    rewriteLatencyMs: plan.latencyMs,
    totalLatencyMs: Date.now() - started,
    rerank: {
      ran: reranked.ran,
      provider: reranked.provider,
      candidates: reranked.candidates,
      topScore: reranked.topScore,
      rankCorrection: reranked.rankCorrection,
      noRelevantEvidence: reranked.noRelevantEvidence,
      latencyMs: reranked.latencyMs,
    },
  };

  return {
    hits: hits as (FusedHit & KbHit)[],
    record,
    noRelevantEvidence: reranked.noRelevantEvidence,
    conflict: { conflicted, reason: conflictReason, resolution },
  };
}
