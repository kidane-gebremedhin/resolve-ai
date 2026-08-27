import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// One row per ingestion stage per attempt.
//
// A SEPARATE COLLECTION rather than an array on `KnowledgeSource`, deliberately:
//
// - It grows without bound. Each attempt emits up to five stage events, the
//   reconcile job retries up to three times, and a website source is re-crawled
//   on a schedule. An embedded array would grow the source document forever, and
//   the source doc is read on the retrieval hot path during hydration.
// - The operator dashboard aggregates ACROSS sources — failure rate by error
//   class, mean duration by type — which an embedded array cannot answer without
//   unwinding every source in the org.
// - It needs its own retention. Diagnostics are worth 30 days, not the lifetime
//   of the knowledge base.
const ingestionEventSchema = new Schema(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: "KnowledgeSource", required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "Agent" },
    stage: {
      type: String,
      enum: ["parse", "chunk", "embed", "upsert", "cleanup", "retry", "recover"],
      required: true,
    },
    status: { type: String, enum: ["ok", "error", "skipped"], required: true },
    durationMs: { type: Number },
    chunkCount: { type: Number },
    byteSize: { type: Number },
    errorCode: { type: String },
    /** Operator-facing text, not the raw provider string. */
    errorMessage: { type: String },
    /** What the operator should do about it. */
    errorAction: { type: String },
    /** The raw provider message, for support. Never shown as the diagnosis. */
    errorRaw: { type: String },
    /** Which attempt this was. 1 for the first run. */
    attempt: { type: Number, default: 1 },
    /**
     * Ties every stage of one ingest run together, including the reconcile
     * job's retries. Without it a timeline is a pile of rows with no way to
     * tell which run each belonged to.
     */
    runId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

// The per-source timeline, newest run first.
ingestionEventSchema.index({ sourceId: 1, createdAt: -1 });
// The org-level health widget: failure rate by class, duration by type.
ingestionEventSchema.index({ organizationId: 1, createdAt: -1 });
ingestionEventSchema.index({ organizationId: 1, errorCode: 1, createdAt: -1 });
// Diagnostics are worth 30 days, not forever.
ingestionEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export type IngestionEventDocType = InferSchemaType<typeof ingestionEventSchema>;
export const IngestionEvent: Model<IngestionEventDocType> =
  mongoose.models.IngestionEvent ?? mongoose.model("IngestionEvent", ingestionEventSchema);
