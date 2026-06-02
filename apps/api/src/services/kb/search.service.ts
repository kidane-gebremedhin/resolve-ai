import { embed } from "../ai/embedding.service.js";
import { getPineconeIndex } from "../../config/pinecone.js";
import { KnowledgeSource } from "../../models/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export type KbHit = {
  sourceId: string;
  sourceTitle: string;
  chunkIndex: number;
  text: string;
  score: number;
};

export async function searchKb(args: {
  query: string;
  organizationId: string;
  /** Knowledge is keyed by (organizationId, agentId) and every retrieval MUST be
   *  scoped to a single agent's KB — no cross-agent bleed within an org. */
  agentId: string;
  topK?: number;
  minScore?: number;
}): Promise<KbHit[]> {
  // Defaults come from env (`AI_KB_SEARCH_TOP_K`, `AI_KB_SEARCH_MIN_SCORE`).
  // Callers can still override per-request — e.g. a "low confidence retry"
  // could lower minScore to widen recall.
  const {
    query,
    organizationId,
    agentId,
    topK = env.ai.kbSearchTopK,
    minScore = env.ai.kbSearchMinScore,
  } = args;
  if (!query.trim()) return [];
  // Hard guard: never run an unscoped KB query. An empty agentId would otherwise
  // widen the filter to the whole org and leak another agent's knowledge.
  if (!agentId) {
    logger.error("[kb] search called without agentId — refusing unscoped query", {
      organizationId,
    });
    return [];
  }

  // A KB lookup is an enhancement, not a hard dependency of the AI reply.
  // If embedding or Pinecone fails even after their built-in retries, degrade
  // to "no hits" so the agent can still respond, rather than failing the reply.
  const pinecone = getPineconeIndex();
  let res: { matches: { id: string; score: number; metadata?: Record<string, unknown> }[] };
  try {
    const [queryVector] = await embed([query]);
    if (!queryVector) return [];
    // Always scope to the agent's KB, AND-ed with the org as defence in depth so
    // a stray vector can never cross either boundary.
    const filter = {
      $and: [{ agentId: { $eq: agentId } }, { organizationId: { $eq: organizationId } }],
    };
    res = await pinecone.query({
      vector: queryVector,
      topK,
      includeMetadata: true,
      filter,
    });
  } catch (err) {
    logger.error("[kb] search failed, degrading to no hits", {
      organizationId,
      err: (err as Error).message,
    });
    return [];
  }

  const hits = res.matches.filter((m) => m.score >= minScore);
  if (hits.length === 0) return [];

  const sourceIds = Array.from(
    new Set(hits.map((h) => String(h.metadata?.sourceId ?? "")).filter(Boolean)),
  );
  const sources = await KnowledgeSource.find(
    { _id: { $in: sourceIds }, organizationId },
    { title: 1 },
  ).lean();
  const titleById = new Map(sources.map((s) => [s._id.toString(), s.title]));

  return hits.map((h) => ({
    sourceId: String(h.metadata?.sourceId ?? ""),
    sourceTitle: titleById.get(String(h.metadata?.sourceId ?? "")) ?? "Untitled",
    chunkIndex: Number(h.metadata?.chunkIndex ?? 0),
    text: String(h.metadata?.text ?? ""),
    score: h.score,
  }));
}
