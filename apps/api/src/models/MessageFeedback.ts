import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const messageFeedbackSchema = new Schema(
  {
    messageId: { type: Schema.Types.ObjectId, ref: "Message", required: true, unique: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    rating: { type: String, enum: ["up", "down"], required: true },
    reason: { type: String },
    contactSessionId: { type: Schema.Types.ObjectId, ref: "ContactSession", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

messageFeedbackSchema.index({ conversationId: 1 });
messageFeedbackSchema.index({ organizationId: 1, createdAt: -1 });

export type MessageFeedbackDocType = InferSchemaType<typeof messageFeedbackSchema>;
export const MessageFeedback: Model<MessageFeedbackDocType> =
  mongoose.models.MessageFeedback ?? mongoose.model("MessageFeedback", messageFeedbackSchema);
