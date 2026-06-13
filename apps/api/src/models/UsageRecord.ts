import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Stores the token usage and USD cost for every LLM call (one record per
// generateAiReply invocation — covers tool-loop + final call combined).
// The `period` field (YYYY-MM) is pre-computed to make monthly aggregations fast
// without needing a $dateToString projection on every query.
const usageRecordSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    websiteId: { type: Schema.Types.ObjectId, ref: "Website", default: null },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", default: null },
    // OpenRouter generation IDs — stored as an array because a single agent
    // turn can involve multiple LLM calls (tool loop + final reply).
    generationIds: { type: [String], default: [] },
    model: { type: String, default: "" },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    // Actual cost in USD as returned by OpenRouter's /generation endpoint.
    // May be 0 if the cost fetch timed out — analytics will show undercount
    // but enforcement is unaffected (it sums stored records).
    costUsd: { type: Number, default: 0 },
    // Pre-computed YYYY-MM for cheap monthly groupings.
    period: { type: String, required: true }, // e.g. "2026-06"
  },
  { timestamps: true },
);

usageRecordSchema.index({ organizationId: 1, period: 1 });
usageRecordSchema.index({ websiteId: 1, period: 1 });
// TTL: auto-delete records older than 2 years so the collection doesn't grow unbounded.
usageRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 730 });

export type UsageRecordDocType = InferSchemaType<typeof usageRecordSchema>;
export const UsageRecord: Model<UsageRecordDocType> =
  mongoose.models.UsageRecord ?? mongoose.model("UsageRecord", usageRecordSchema);
