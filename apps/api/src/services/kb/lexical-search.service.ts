// Lexical retrieval over the `KbChunk` mirror.
//
// This is the leg dense retrieval cannot cover. An embedding of "ERR_4021" is
// not meaningfully close to a passage containing it: rare tokens carry almost no
// semantic signal, which is exactly what makes them precise. Order ids, error
// codes, SKUs, policy clause numbers and product names are the tokens customers
// paste verbatim, and they are the ones vector search is worst at.
//
// The tenancy guarantee here is identical to `searchKb`'s, and deliberately
// duplicated rather than shared: this is a second query path into customer
// knowledge, and a guard that lives somewhere else is a guard that can be
// forgotten when a third one is added.
import { KbChunk } from "../../models/index.js";
import { logger } from "../../config/logger.js";
import type { KbHit } from "./search.service.js";

export type LexicalHit = KbHit & { chunkId: string };

/**
 * MongoDB `$text` scores are unbounded and corpus-relative — they are not
 * comparable to a cosine score and must never be shown next to one. They exist
 * here only to produce a RANK, which is what fusion consumes.
 */
export async function lexicalSearch(args: {
  query: string;
  organizationId: string;
  agentId: string;
  topK: number;
}): Promise<LexicalHit[]> {
  const { query, organizationId, agentId, topK } = args;
  if (!query.trim()) return [];

  // Hard guard, mirroring `searchKb`. An empty agentId would widen the filter to
  // the whole org and leak another agent's knowledge.
  if (!agentId) {
    logger.error("[kb] lexical search called without agentId — refusing unscoped query", {
      organizationId,
    });
    return [];
  }
  if (!organizationId) {
    logger.error("[kb] lexical search called without organizationId — refusing unscoped query");
    return [];
  }

  const rows = await KbChunk.find(
    {
      // AND-scoped to both, as defence in depth: a stray chunk can never cross
      // either boundary even if one field is wrong.
      organizationId,
      agentId,
      $text: { $search: query },
    },
    { score: { $meta: "textScore" }, text: 1, headingPath: 1, url: 1, sourceId: 1, chunkIndex: 1, chunkId: 1 },
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(topK)
    .lean();

  return rows.map((r) => ({
    sourceId: String(r.sourceId),
    // Hydrated by the caller, which already loads titles for the dense leg.
    sourceTitle: "",
    chunkIndex: r.chunkIndex,
    chunkId: r.chunkId,
    text: r.text,
    score: Number((r as unknown as { score?: number }).score ?? 0),
    ...(r.url ? { url: r.url } : {}),
  }));
}
