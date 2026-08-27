/**
 * Per-case execution.
 *
 * The harness measures production or it measures nothing, so this file contains
 * no retrieval logic and no prompt construction of its own. Retrieval is
 * `searchKb`; generation is `generateAiReply` driving the real LangGraph agent,
 * whose reply this reads back off the persisted `Message`. If a future change
 * makes it tempting to "just call Pinecone directly here", that is the moment
 * the eval stops describing the product.
 *
 * Retrieval and generation are measured with two separate calls on purpose.
 * `generateAiReply` only persists the sources it ultimately cited, which is not
 * the ranked candidate list the retrieval metrics need; the retrieval path gives
 * the ranking, at the cost of one extra embedding per case.
 *
 * Retrieval goes through `understoodSearch`, which is the production path since
 * query understanding shipped: it rewrites, expands, fuses and optionally runs
 * one follow-up round before `searchKb` ever sees a string. Calling `searchKb`
 * directly would measure a path no customer takes and would report exactly zero
 * of the effect a rewriting change has, which is the one thing the retrieval
 * metrics exist to detect.
 */
import mongoose from "mongoose";
import { Conversation, Message } from "@api/models/index.js";
import { env } from "@api/config/env.js";
import { searchKb } from "@api/services/kb/search.service.js";
import { KnowledgeBaseRetriever } from "@api/services/ai/retrieval/kb-retriever.js";
import { understoodSearch } from "@api/services/ai/retrieval/understood-search.js";
import { generateAiReply } from "@api/services/ai/index.js";
import type { FixtureWorkspace } from "./fixtures.js";
import type { EvalCase, RetrievalScores } from "./types.js";
import { isNegativeCase } from "./types.js";
import {
  meanOf,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  type RankedItem,
} from "./metrics/retrieval.js";

export type RetrievedPassage = { id: string; sourceId: string; title: string; text: string; score: number };

/**
 * Resolve a case's expected ids against the fixture workspace.
 *
 * Cases name documents by slug, not by ObjectId, because the ids change every
 * time the fixture is reseeded. Anything that fails to resolve is loud: a typo'd
 * slug would otherwise silently turn a positive case into a negative one and
 * quietly inflate the refusal rate.
 */
export function resolveExpectedSourceIds(
  expected: readonly string[],
  sourceIdBySlug: Record<string, string>,
): string[] {
  return expected.map((slug) => {
    const id = sourceIdBySlug[slug];
    if (!id) {
      throw new Error(
        `Unknown fixture document slug "${slug}". Known: ${Object.keys(sourceIdBySlug).join(", ")}`,
      );
    }
    return id;
  });
}

export async function runRetrieval(args: {
  question: string;
  workspace: FixtureWorkspace;
  expectedSourceIds: string[];
  ks: number[];
  /** Prior turns, so a follow-up case is scored the way production would see it. */
  history?: { role: string; content: string }[];
  /** Fixture document titles, standing in for the org vocabulary. */
  vocabulary?: string[];
  caseId?: string;
}): Promise<{
  scores: RetrievalScores;
  passages: RetrievedPassage[];
  rewrite: { originalQuery: string; rewrittenQuery: string; queriesRun: string[]; rewritten: boolean; followUpRan: boolean; rewriteLatencyMs: number; totalLatencyMs: number };
}> {
  const maxK = Math.max(...args.ks, env.ai.kbSearchTopK);
  const started = Date.now();

  // Widen deliberately to the largest K under evaluation. Scoring Recall@10 off
  // a top-5 fetch would report a ceiling that is an artefact of the request, not
  // of retrieval quality.
  const retriever = new KnowledgeBaseRetriever({
    organizationId: args.workspace.organizationId,
    agentId: args.workspace.agentId,
    topK: maxK,
  });

  const { hits, record } = await understoodSearch({
    // Stage 2 truncates to the context size, so it must be told the evaluation
    // width. Leaving it at the production default silently caps Recall@10 at
    // whatever `AI_KB_SEARCH_TOP_K` happens to be, which reads as a retrieval
    // regression caused by reranking when it is really the harness measuring a
    // narrower window than it asked for.
    topK: maxK,
    query: args.question,
    // A stable id per case keeps the rewrite cache useful across the two
    // retrievals a single case can trigger, without letting one case's rewrite
    // leak into another's.
    conversationId: `rag-eval:${args.caseId ?? args.question}`,
    retriever,
    history: args.history ?? [],
    vocabulary: args.vocabulary ?? [],
  });
  const latencyMs = Date.now() - started;

  const passages: RetrievedPassage[] = hits.map((h) => ({
    id: String((h as { chunkId?: string; id?: string }).chunkId ?? (h as { id?: string }).id ?? ""),
    sourceId: String((h as { sourceId?: unknown }).sourceId ?? ""),
    title: String((h as { sourceTitle?: string; title?: string }).sourceTitle ?? (h as { title?: string }).title ?? ""),
    text: String((h as { text?: string }).text ?? ""),
    score: Number((h as { score?: number }).score ?? 0),
  }));

  // Retrieval is scored at source granularity: chunk indices move whenever the
  // chunker changes, and a case that says "the answer is in refunds.md" should
  // survive that. The ranked list is deduplicated to first appearance per source
  // so a document that occupies three of five slots does not count three times.
  const seen = new Set<string>();
  const ranked: RankedItem[] = [];
  for (const p of passages) {
    if (seen.has(p.sourceId)) continue;
    seen.add(p.sourceId);
    ranked.push({ id: p.sourceId, score: p.score });
  }

  const byK = <T>(fn: (k: number) => T): Record<string, T> =>
    Object.fromEntries(args.ks.map((k) => [String(k), fn(k)]));

  const productionTopK = env.ai.kbSearchTopK;
  const relevant = new Set(args.expectedSourceIds);

  return {
    passages,
    rewrite: {
      originalQuery: record.originalQuery,
      rewrittenQuery: record.rewrittenQuery,
      queriesRun: record.queriesRun,
      rewritten: record.rewritten,
      followUpRan: record.followUpRan,
      rewriteLatencyMs: record.rewriteLatencyMs,
      totalLatencyMs: record.totalLatencyMs,
    },
    scores: {
      recallAtK: byK((k) => recallAtK(ranked, args.expectedSourceIds, k)),
      precisionAtK: byK((k) => precisionAtK(ranked, args.expectedSourceIds, k)),
      ndcgAtK: byK((k) => ndcgAtK(ranked, args.expectedSourceIds, k)),
      reciprocalRank: reciprocalRank(ranked, args.expectedSourceIds),
      hitAtProductionK:
        args.expectedSourceIds.length === 0
          ? null
          : ranked.slice(0, productionTopK).some((r) => relevant.has(r.id)),
      // `KnowledgeBaseRetriever` re-queries with minScore 0 when the first pass
      // returns nothing. An empty result here is that same condition, observed
      // one layer down.
      widenedOnEmpty: passages.length === 0,
      retrievedCount: passages.length,
      topScore: passages[0]?.score ?? null,
      latencyMs,
    },
  };
}

export type GenerationRun = {
  answer: string;
  action: string;
  confidence: number | null;
  conversationId: string;
  citedSourceIds: string[];
  latencyMs: number;
};

/**
 * Drive one real turn through the agent.
 *
 * A fresh conversation per case keeps cases independent; `history` is replayed
 * as persisted messages first, because the graph rebuilds context from the
 * conversation's message history and a follow-up like "what about the annual
 * one?" is meaningless without it.
 */
export async function runGeneration(args: {
  evalCase: EvalCase;
  workspace: FixtureWorkspace;
}): Promise<GenerationRun> {
  const { evalCase: c, workspace } = args;

  const conversation = await Conversation.create({
    threadId: `rag-eval-${c.id}-${Date.now()}`,
    organizationId: new mongoose.Types.ObjectId(workspace.organizationId),
    websiteId: new mongoose.Types.ObjectId(workspace.websiteId),
    agentId: new mongoose.Types.ObjectId(workspace.agentId),
    contactSessionId: new mongoose.Types.ObjectId(workspace.contactSessionId),
    status: "active",
  });

  for (const turn of c.history) {
    await Message.create({
      conversationId: conversation._id,
      organizationId: conversation.organizationId,
      role: turn.role === "ai" ? "ai" : "customer",
      senderType: turn.role === "ai" ? "ai" : "customer",
      content: turn.content,
    });
  }

  const before = await Message.countDocuments({ conversationId: conversation._id });
  const started = Date.now();
  // `io` is null: there is no socket to emit to, and the runner deliberately
  // takes the same path a real turn does rather than a test-only variant.
  await generateAiReply(conversation, c.question, null);
  const latencyMs = Date.now() - started;

  const produced = await Message.find({ conversationId: conversation._id })
    .sort({ createdAt: 1 })
    .skip(before)
    .lean();
  const reply = produced.filter((m) => m.role === "ai").pop();

  return {
    answer: String(reply?.content ?? ""),
    // The persisted message carries no action field; escalation is inferred the
    // way the product surfaces it, from the conversation's own state.
    action:
      (await Conversation.findById(conversation._id).select("status").lean())?.status === "escalated"
        ? "escalate"
        : "reply",
    confidence: typeof reply?.confidence === "number" ? reply.confidence : null,
    conversationId: conversation._id.toString(),
    citedSourceIds: ((reply?.sources ?? []) as { sourceId?: string }[])
      .map((s) => String(s.sourceId ?? ""))
      .filter(Boolean),
    latencyMs,
  };
}

export { meanOf, isNegativeCase };
