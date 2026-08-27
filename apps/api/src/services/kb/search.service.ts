import { KbEmbeddings } from "../ai/retrieval/embeddings.js";
import { getPineconeIndex } from "../../config/pinecone.js";
import { KbChunk, KnowledgeSource } from "../../models/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { lexicalSearch } from "./lexical-search.service.js";
import { fuseHybrid } from "./hybrid-fusion.js";

export type KbHit = {
  sourceId: string;
  sourceTitle: string;
  chunkIndex: number;
  text: string;
  score: number;
  url?: string;
  /** `<sourceId>:<chunkIndex>`, matching the Pinecone vector id. */
  chunkId?: string;
  /** Heading stack above this chunk, from the Mongo mirror. */
  headingPath?: string[];
  /** Which leg(s) retrieved this passage. Diagnostic; never shown to the model. */
  retrievedBy?: ("dense" | "lexical")[];
  /**
   * The cross-encoder's calibrated score, when stage 2 ran. Comparable across
   * queries in a way the raw cosine `score` is not, which is what makes it the
   * useful signal for per-chunk index health.
   */
  rerankScore?: number;
  /** Operator-set authority of the parent source. Higher wins a contradiction. */
  priority?: number;
  /** When the parent source's CONTENT last changed. Breaks a priority tie. */
  sourceUpdatedAt?: Date | string | null;
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

  // Two legs, in parallel. Dense finds passages that MEAN the same thing;
  // lexical finds passages that CONTAIN the same rare tokens. Neither subsumes
  // the other, and the second one only runs when alpha leaves room for it.
  const useLexical = env.kb.hybridAlpha < 1;

  const densePromise = denseSearch({ query, organizationId, agentId, topK });
  const lexicalPromise = useLexical
    ? withTimeout(
        lexicalSearch({ query, organizationId, agentId, topK }),
        env.kb.lexicalTimeoutMs,
      ).catch((err: Error) => {
        // The lexical leg is an enhancement. Losing it degrades retrieval to
        // exactly what it was before hybrid shipped, which is a working system.
        logger.warn("[kb] lexical leg failed, degrading to dense-only", {
          organizationId,
          err: err.message,
        });
        return null;
      })
    : Promise.resolve(null);

  const [dense, lexical] = await Promise.all([densePromise, lexicalPromise]);

  // The score floor applies to the DENSE leg only. A `$text` score is unbounded
  // and corpus-relative, so `AI_KB_SEARCH_MIN_SCORE` — a cosine threshold — has
  // no meaning against it, and applying it would silently drop every lexical hit
  // or none depending on the corpus.
  const denseAboveFloor = dense.filter((h) => h.score >= minScore);

  const legs =
    lexical && lexical.length > 0
      ? [
          { leg: "dense" as const, hits: denseAboveFloor },
          { leg: "lexical" as const, hits: lexical },
        ]
      : [{ leg: "dense" as const, hits: denseAboveFloor }];

  const fused =
    legs.length === 1
      ? denseAboveFloor.slice(0, topK).map((h) => ({ ...h, retrievedBy: ["dense" as const] }))
      : fuseHybrid(legs, {
          alpha: env.kb.hybridAlpha,
          strategy: env.kb.hybridFusion,
          topK,
        });

  if (fused.length === 0) return [];
  return hydrate(fused, organizationId);
}

/** Reject after `ms`, so a slow lexical leg cannot hold up the turn. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`lexical search timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
}

/** The vector leg: unchanged behaviour, extracted so the two legs are symmetrical. */
async function denseSearch(args: {
  query: string;
  organizationId: string;
  agentId: string;
  topK: number;
}): Promise<KbHit[]> {
  const { query, organizationId, agentId, topK } = args;
  // A KB lookup is an enhancement, not a hard dependency of the AI reply.
  // If embedding or Pinecone fails even after their built-in retries, degrade
  // to "no hits" so the agent can still respond, rather than failing the reply.
  const pinecone = getPineconeIndex();
  let res: { matches: { id: string; score: number; metadata?: Record<string, unknown> }[] };
  try {
    // Embed through the LangChain adapter so every vector in the system — whether
    // produced by ingestion or by a retrieval call — goes through one interface.
    // It delegates to the same embedding service, so batching, retry, the
    // non-production fallback and per-org usage metering all still apply.
    const queryVector = await new KbEmbeddings({ organizationId }).embedQuery(query);
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

  return res.matches.map((h) => {
    const sid = String(h.metadata?.sourceId ?? "");
    const chunkIndex = Number(h.metadata?.chunkIndex ?? 0);
    const chunkUrl =
      typeof h.metadata?.url === "string" && h.metadata.url ? h.metadata.url : undefined;
    return {
      sourceId: sid,
      sourceTitle: "",
      chunkIndex,
      chunkId: h.id || `${sid}:${chunkIndex}`,
      // Pinecone metadata is the FALLBACK now, not the source of truth: it is
      // truncated at 8000 chars and `hydrate` replaces it from Mongo. Vectors
      // written before the mirror existed still have only this.
      text: String(h.metadata?.text ?? ""),
      score: h.score,
      ...(chunkUrl ? { url: chunkUrl } : {}),
    };
  });
}

/**
 * Fill in source titles, URLs, and the authoritative chunk text.
 *
 * Text comes from the `KbChunk` mirror, never from Pinecone metadata, which is
 * truncated at 8000 characters. The metadata copy remains as a fallback for
 * vectors written before the mirror existed, so an un-backfilled deployment
 * degrades to the old behaviour rather than returning empty passages.
 */
async function hydrate(hits: KbHit[], organizationId: string): Promise<KbHit[]> {
  const sourceIds = Array.from(new Set(hits.map((h) => h.sourceId).filter(Boolean)));
  const chunkIds = hits.map((h) => h.chunkId).filter((id): id is string => Boolean(id));

  const [sources, chunks] = await Promise.all([
    KnowledgeSource.find({ _id: { $in: sourceIds }, organizationId }, { title: 1, sourceUrl: 1 }).lean(),
    chunkIds.length > 0
      ? KbChunk.find(
          { chunkId: { $in: chunkIds }, organizationId },
          { chunkId: 1, text: 1, headingPath: 1, url: 1, priority: 1, sourceUpdatedAt: 1 },
        ).lean()
      : Promise.resolve([]),
  ]);

  const titleById = new Map(sources.map((s) => [s._id.toString(), s.title]));
  const urlById = new Map(
    sources.map((s) => [s._id.toString(), (s.sourceUrl as string | undefined) ?? undefined]),
  );
  const chunkById = new Map(chunks.map((c) => [c.chunkId, c]));

  return hits.map((h) => {
    const mirror = h.chunkId ? chunkById.get(h.chunkId) : undefined;
    return {
      ...h,
      sourceTitle: titleById.get(h.sourceId) ?? "Untitled",
      text: mirror?.text ?? h.text,
      ...(mirror?.headingPath?.length ? { headingPath: mirror.headingPath } : {}),
      // Denormalised onto the chunk at ingest so conflict resolution can order
      // sources without a join per hit.
      priority: mirror?.priority ?? 0,
      sourceUpdatedAt: mirror?.sourceUpdatedAt ?? null,
      // Prefer the exact page URL stored per-chunk (website crawls tag each chunk
      // with its originating page). Fall back to the source-level sourceUrl.
      url: h.url ?? mirror?.url ?? urlById.get(h.sourceId),
    };
  });
}
