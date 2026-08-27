// LangChain retriever over the org/agent-scoped Pinecone knowledge base.
//
// Wrapping `searchKb()` keeps the tenancy guarantee in one place (a query is
// always AND-scoped to organizationId AND agentId) while giving the agent a
// standard Runnable that LangSmith traces as a retriever step.

import { BaseRetriever, type BaseRetrieverInput } from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import { searchKb, type KbHit } from "../../kb/search.service.js";
import { env } from "../../../config/env.js";

export type KbDocMetadata = {
  sourceId: string;
  sourceTitle: string;
  chunkIndex: number;
  score: number;
  url?: string;
};

/**
 * What one `searchHits` call did, for online telemetry (__specs/39).
 *
 * Captured HERE rather than reconstructed later, because two of these fields
 * exist nowhere else: `widenedOnEmpty` is a decision made inside this method and
 * leaves no trace in the hits it returns, and `minScore` is the floor that was
 * actually applied, which is not the same as the configured one once the widen
 * retry has fired. The rest is cheap to record while we already hold the list.
 */
export type RetrievalStats = {
  query: string;
  topK: number;
  minScore: number;
  hitCount: number;
  topScore: number | null;
  /** Stage 1 came back empty and the no-floor retry ran. */
  widenedOnEmpty: boolean;
  sourceIds: string[];
  latencyMs: number;
};

export type KbRetrieverFields = BaseRetrieverInput & {
  organizationId: string;
  agentId: string;
  topK?: number;
  minScore?: number;
  /**
   * Re-run with no score floor when the configured threshold filters everything
   * out.
   *
   * This is a workaround for an uncalibrated score, and it is now GATED on
   * reranking being off. The reasoning it was built on — "a weak passage is more
   * useful to the model than nothing" — was only true because a raw cosine
   * threshold could not tell a genuinely irrelevant passage from a relevant one
   * scoring low on a hard query. So the safer bet was to hand over something.
   *
   * A cross-encoder score IS comparable across queries, so stage 2 can say "the
   * knowledge base does not contain this" and mean it. Once that is possible,
   * pushing a zero-relevance passage into the prompt stops being a hedge and
   * becomes a hallucination risk: the model is handed text that looks like
   * evidence and is not.
   */
  widenOnEmpty?: boolean;
};

export class KnowledgeBaseRetriever extends BaseRetriever {
  lc_namespace = ["csb", "retrievers", "knowledge_base"];

  static lc_name(): string {
    return "KnowledgeBaseRetriever";
  }

  private readonly organizationId: string;
  private readonly agentId: string;
  private readonly topK?: number;
  private readonly minScore?: number;
  private readonly widenOnEmpty: boolean;
  /**
   * Stats for every search this instance has run, oldest first.
   *
   * Accumulated on the instance rather than returned from `searchHits`, because
   * one turn's retrieval is several calls — paraphrases fused with RRF, plus the
   * optional follow-up round — and every caller between here and the graph would
   * otherwise have to thread a stats channel through purely to carry it. The
   * retriever is built once per turn, so the instance IS the turn's scope.
   */
  private readonly stats: RetrievalStats[] = [];

  constructor(fields: KbRetrieverFields) {
    super(fields);
    this.organizationId = fields.organizationId;
    this.agentId = fields.agentId;
    this.topK = fields.topK;
    this.minScore = fields.minScore;
    this.widenOnEmpty = fields.widenOnEmpty ?? true;
  }

  /**
   * Raw hits, for callers that need the score/citation shape rather than Documents.
   *
   * `topKOverride` lets stage 1 widen for recall without changing the final
   * context size, which is a different concern and a different setting.
   */
  async searchHits(query: string, topKOverride?: number): Promise<KbHit[]> {
    const started = Date.now();
    const effectiveTopK = topKOverride ?? this.topK;
    const base = {
      query,
      organizationId: this.organizationId,
      agentId: this.agentId,
      ...(effectiveTopK !== undefined ? { topK: effectiveTopK } : {}),
    };
    let appliedMinScore = this.minScore ?? env.ai.kbSearchMinScore;
    let hits = await searchKb({
      ...base,
      ...(this.minScore !== undefined ? { minScore: this.minScore } : {}),
    });

    // Widen only when there is no calibrated score downstream to catch the
    // irrelevant passages this pulls in. With reranking on, stage 2 decides
    // what is relevant and this hedge would only feed it noise.
    const widenAllowed = this.widenOnEmpty && !env.kb.rerankEnabled;
    let widenedOnEmpty = false;
    if (hits.length === 0 && widenAllowed) {
      widenedOnEmpty = true;
      appliedMinScore = 0;
      hits = await searchKb({ ...base, minScore: 0 });
    }

    this.stats.push({
      query,
      topK: effectiveTopK ?? env.ai.kbSearchTopK,
      minScore: appliedMinScore,
      hitCount: hits.length,
      topScore: hits.length > 0 ? Math.max(...hits.map((h) => h.score)) : null,
      widenedOnEmpty,
      sourceIds: [...new Set(hits.map((h) => h.sourceId))],
      latencyMs: Date.now() - started,
    });

    return hits;
  }

  /**
   * Take the searches recorded so far and reset the collector.
   *
   * Draining rather than reading keeps the retriever from growing without bound
   * if an instance is ever reused across turns, and means a telemetry consumer
   * cannot double-count a search it has already reported.
   */
  drainStats(): RetrievalStats[] {
    return this.stats.splice(0, this.stats.length);
  }

  async _getRelevantDocuments(query: string): Promise<Document<KbDocMetadata>[]> {
    const hits = await this.searchHits(query);
    return hits.map(
      (h) =>
        new Document<KbDocMetadata>({
          pageContent: h.text,
          metadata: {
            sourceId: h.sourceId,
            sourceTitle: h.sourceTitle,
            chunkIndex: h.chunkIndex,
            score: h.score,
            ...(h.url ? { url: h.url } : {}),
          },
        }),
    );
  }
}
