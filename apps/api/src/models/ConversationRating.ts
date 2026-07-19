import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const conversationRatingSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true, unique: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    stars: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String },
    resolvedBy: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

conversationRatingSchema.index({ organizationId: 1, createdAt: -1 });

export type ConversationRatingDocType = InferSchemaType<typeof conversationRatingSchema>;
export const ConversationRating: Model<ConversationRatingDocType> =
  mongoose.models.ConversationRating ?? mongoose.model("ConversationRating", conversationRatingSchema);
