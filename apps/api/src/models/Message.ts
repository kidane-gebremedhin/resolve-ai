import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    role: { type: String, enum: ["customer", "ai", "operator", "system"], required: true },
    content: { type: String, required: true },
    senderId: { type: Schema.Types.ObjectId },
    senderType: { type: String, enum: ["contact", "user", "ai", "system"], required: true },
    attachments: {
      type: [
        new Schema(
          {
            fileName: String,
            fileUrl: String,
            mimeType: String,
            size: Number,
            // Text extracted from the file at upload time (PDF/DOCX/Excel/CSV/
            // text/HTML) so the AI can read attachment content. Truncated to
            // ATTACHMENT_EXTRACT_MAX_CHARS. Omitted for images / unsupported types.
            extractedText: String,
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    toolCalls: {
      type: [
        new Schema(
          {
            name: String,
            args: Schema.Types.Mixed,
            result: Schema.Types.Mixed,
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    confidence: { type: Number, min: 0, max: 1 },
    isEnhanced: { type: Boolean },
    originalContent: { type: String },
    readByOperator: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ organizationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, role: 1 });

export type MessageDocType = InferSchemaType<typeof messageSchema>;
export const Message: Model<MessageDocType> =
  mongoose.models.Message ?? mongoose.model("Message", messageSchema);
