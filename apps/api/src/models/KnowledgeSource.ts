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
      enum: ["pending", "processing", "synced", "error", "deleting"],
      required: true,
      default: "pending",
    },
    embeddingError: { type: String },
    lastSyncedAt: { type: Date },
    retryCount: { type: Number, default: 0 },
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
