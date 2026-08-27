import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const knowledgeSourceSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    // Knowledge is scoped to a single AGENT — the canonical identifier is
    // (organizationId, agentId). Each agent maps to exactly one website, so this
    // is effectively per-website but keyed on the config owner (the agent).
    agentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    type: {
      type: String,
      enum: ["text", "pdf", "docx", "excel", "csv", "image", "html", "website"],
      required: true,
    },
    title: { type: String, required: true },
    content: { type: String },
    fileUrl: { type: String },
    fileName: { type: String },
    mimeType: { type: String },
    fileSize: { type: Number },
    sourceUrl: { type: String },
    // For website sources: the site's favicon, resolved on crawl completion and
    // used as the agent's default widget avatar when none is set.
    faviconUrl: { type: String },
    contentHash: { type: String, required: true },
    extractedText: { type: String },
    chunkCount: { type: Number },
    pineconeIds: { type: [String], default: [] },
    embeddingStatus: {
      type: String,
      // `empty` is its own state, not a flavour of `synced`.
      //
      // A zero-chunk ingest used to report success: a scanned PDF with no text
      // layer or an empty crawl ended as `synced` with `chunkCount: 0`, looking
      // identical to a working source while retrieving nothing. It is a
      // failure, it is permanent until the file changes, and the reconcile job
      // deliberately does not retry it — retrying an image-only PDF produces an
      // image-only PDF.
      enum: ["pending", "processing", "synced", "empty", "error", "deleting"],
      required: true,
      default: "pending",
    },
    /**
     * Operator-facing failure text. NOT the raw provider message, which lives on
     * the ingestion event.
     *
     * This field is overloaded: `POST /knowledge/website` stashes an in-flight
     * crawl id here as `firecrawl:<id>` for the poll job to read back. Anything
     * writing or clearing it must follow both readers.
     */
    embeddingError: { type: String },
    /** Latch so an unresolved source does not re-alert every reconcile tick. */
    ingestAlerted: { type: Boolean, default: false },
    /** Taxonomy code, which is what the retry loop reads to decide policy. */
    embeddingErrorCode: { type: String },
    /** What the operator should do about it. */
    embeddingErrorAction: { type: String },
    lastSyncedAt: { type: Date },
    retryCount: { type: Number, default: 0 },
    /**
     * Operator marked this source as no longer trustworthy.
     *
     * Distinct from deleting it and distinct from dropping its priority: a
     * stale source is one an operator has judged out of date but is not ready
     * to remove, usually because nothing replaces it yet. It stays indexed and
     * retrievable — hiding it silently would turn "this answer is out of date"
     * into "we have no answer", which is worse — and the flag is what the
     * knowledge-health surface sorts and filters on.
     */
    stale: { type: Boolean, default: false },
    staleAt: { type: Date },
    /**
     * Operator-settable authority. Higher wins when two sources disagree.
     *
     * Separate from recency on purpose: "the newest page" and "the page we
     * actually stand behind" are different questions, and a re-crawl of a stale
     * archive page would otherwise outrank a hand-written policy document.
     */
    priority: { type: Number, default: 0 },
    /**
     * When the source's CONTENT last changed, not when the row was touched.
     *
     * `updatedAt` moves on every reingest, retry and status change, so it says
     * nothing about which of two documents is more current. This only moves when
     * `contentHash` does.
     */
    sourceUpdatedAt: { type: Date },
    version: { type: Number, required: true, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Dedup is per-agent: the same document may legitimately exist for two agents.
knowledgeSourceSchema.index({ agentId: 1, contentHash: 1 }, { unique: true });
knowledgeSourceSchema.index({ agentId: 1, type: 1 });
knowledgeSourceSchema.index({ agentId: 1, embeddingStatus: 1 });
knowledgeSourceSchema.index({ organizationId: 1 });
knowledgeSourceSchema.index({ embeddingStatus: 1, retryCount: 1 });

export type KnowledgeSourceDocType = InferSchemaType<typeof knowledgeSourceSchema>;
export const KnowledgeSource: Model<KnowledgeSourceDocType> =
  mongoose.models.KnowledgeSource ?? mongoose.model("KnowledgeSource", knowledgeSourceSchema);
