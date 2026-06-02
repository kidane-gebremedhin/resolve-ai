import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const conversationSchema = new Schema(
  {
    threadId: { type: String, required: true, unique: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    websiteId: { type: Schema.Types.ObjectId, ref: "Website", required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    contactSessionId: { type: Schema.Types.ObjectId, ref: "ContactSession", required: true },
    status: {
      type: String,
      enum: ["active", "escalated", "resolved", "expired"],
      required: true,
      default: "active",
    },
    assignedOperatorId: { type: Schema.Types.ObjectId, ref: "User" },
    subject: { type: String },
    lastMessageAt: { type: Date },
    lastMessagePreview: { type: String },
    messageCount: { type: Number, default: 0 },
    resolvedAt: { type: Date },
    resolvedBy: { type: String, enum: ["ai", "operator", "system"] },
    escalatedAt: { type: Date },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

conversationSchema.index({ organizationId: 1, status: 1, lastMessageAt: -1 });
conversationSchema.index({ organizationId: 1, websiteId: 1, status: 1 });
conversationSchema.index({ contactSessionId: 1 });
conversationSchema.index({ organizationId: 1, assignedOperatorId: 1 });

export type ConversationDocType = InferSchemaType<typeof conversationSchema>;
export const Conversation: Model<ConversationDocType> =
  mongoose.models.Conversation ?? mongoose.model("Conversation", conversationSchema);
