// LangChain Embeddings adapter over the project's embedding service.
//
// It wraps `embed()` rather than replacing it with OpenAIEmbeddings on purpose:
// the existing implementation carries batching, retry/backoff, the
// non-production pseudo-embedding fallback, and per-org usage metering. Those
// must apply identically whether a vector is produced by KB ingestion or by a
// LangChain retriever, so both paths share the one implementation.

import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import { embed } from "../embedding.service.js";

export type KbEmbeddingsFields = EmbeddingsParams & {
  /** Attributes the token spend of these embeddings to an org's budget. */
  organizationId?: string | null;
  websiteId?: string | null;
};

export class KbEmbeddings extends Embeddings {
  private readonly organizationId: string | null;
  private readonly websiteId: string | null;

  constructor(fields: KbEmbeddingsFields = {}) {
    super(fields);
    this.organizationId = fields.organizationId ?? null;
    this.websiteId = fields.websiteId ?? null;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return embed(documents, {
      organizationId: this.organizationId,
      websiteId: this.websiteId,
      feature: "embedding",
    });
  }

  async embedQuery(document: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([document]);
    if (!vector) throw new Error("embedQuery produced no vector");
    return vector;
  }
}
