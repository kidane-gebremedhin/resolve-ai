import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const toolCallLogSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    contactSessionId: { type: Schema.Types.ObjectId, ref: "ContactSession", required: true },
    connectionId: { type: Schema.Types.ObjectId, ref: "Connection" },
    toolKey: { type: String, required: true },
    argsMasked: { type: Schema.Types.Mixed, required: true },
    resultSummary: { type: String },
    status: {
      type: String,
      enum: ["success", "guardrail_blocked", "error", "otp_pending"],
      required: true,
    },
    errorMessage: { type: String },
    durationMs: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// TTL: auto-delete logs older than 90 days
toolCallLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
toolCallLogSchema.index({ organizationId: 1, conversationId: 1 });

export type ToolCallLogDocType = InferSchemaType<typeof toolCallLogSchema>;
export const ToolCallLog: Model<ToolCallLogDocType> =
  mongoose.models.ToolCallLog ?? mongoose.model("ToolCallLog", toolCallLogSchema);
