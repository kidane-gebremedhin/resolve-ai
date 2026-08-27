import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// The durable, queryable copy of every knowledge-base chunk.
//
// Two jobs, and it is worth being clear that the second one is the reason the
// first was affordable:
//
// 1. **Lexical retrieval.** Dense vectors miss exact tokens — order ids, error
//    codes, SKUs, clause numbers, product names — because an embedding of
//    "ERR_4021" is not meaningfully near the embedding of a passage containing
//    it. A text index over the same chunks catches precisely those.
//
// 2. **Chunk text stops living only in Pinecone metadata**, where it was
//    truncated at 8000 characters and served as retrieval's source of truth.
//    A vector store is an index, not a database: it has no transactions, its
//    metadata has a size ceiling, and a reindex loses anything only stored
//    there. Retrieval now reads text from here.
//
// The `$text` index is deliberately portable. MongoDB Atlas Search would give
// better relevance (real BM25, configurable analyzers, per-field weights) but
// only exists on Atlas, and this repo runs `mongo:7` in docker for local and CI.
// `$text` works on both. `lexicalSearch()` is written behind a narrow interface
// so an Atlas deployment can swap the implementation without touching callers.
const kbChunkSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    // Knowledge is keyed by (organizationId, agentId) and every query must be
    // scoped to both. Stored on the chunk so the lexical filter can enforce the
    // same tenancy guarantee the vector filter does, rather than joining.
    agentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    sourceId: { type: Schema.Types.ObjectId, ref: "KnowledgeSource", required: true },
    chunkIndex: { type: Number, required: true },
    /** `<sourceId>:<chunkIndex>`, matching the Pinecone vector id exactly. */
    chunkId: { type: String, required: true, unique: true },
    /** The chunk as it appears in the document. Never truncated. */
    text: { type: String, required: true },
    /** Heading stack above this chunk, outermost first. */
    headingPath: { type: [String], default: [] },
    /** Per-page attribution for website sources. */
    url: { type: String },
    /** Rough token count (4 chars ≈ 1 token), for context-budget accounting. */
    tokenCount: { type: Number },
    /**
     * Copied from the parent `KnowledgeSource` at ingest so conflict resolution
     * can order passages without joining back to it per hit. Denormalised on
     * purpose: this is read on the retrieval hot path for every candidate.
     */
    priority: { type: Number, default: 0 },
    sourceUpdatedAt: { type: Date },
  },
  { timestamps: true },
);

// Lexical retrieval. A single text index per collection is a MongoDB limit, so
// `headingPath` is weighted alongside the text rather than indexed separately:
// a heading match is a strong signal ("Refunds" as a heading beats "refunds"
// mentioned in passing), but the body is where the facts are.
kbChunkSchema.index(
  { text: "text", headingPath: "text" },
  { weights: { text: 1, headingPath: 3 }, name: "kb_chunk_text" },
);

// Every lexical query filters on both tenancy fields before scoring, so the
// compound index has to lead with them.
kbChunkSchema.index({ organizationId: 1, agentId: 1 });
// Re-ingest deletes a source's chunks by source.
kbChunkSchema.index({ sourceId: 1, chunkIndex: 1 });

export type KbChunkDocType = InferSchemaType<typeof kbChunkSchema>;
export const KbChunk: Model<KbChunkDocType> =
  mongoose.models.KbChunk ?? mongoose.model("KbChunk", kbChunkSchema);
