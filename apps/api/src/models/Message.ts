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
    // KB citations surfaced below this AI reply
    sources: {
      type: [
        new Schema(
          {
            sourceId: String,
            sourceTitle: String,
            url: String,
            score: Number,
            // Added for inline citations. Every field above keeps its meaning,
            // so a message written before these existed renders exactly as it
            // always did — the widget falls back to the collapsible source list
            // when `marker` is absent.
            /** The integer shown inline in the reply, e.g. the 2 in "[2]". */
            marker: Number,
            /** `<sourceId>:<chunkIndex>` — which passage, not just which document. */
            chunkId: String,
            /** Heading stack, so a citation can name the section it came from. */
            headingPath: [String],
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    // Short suggested follow-up chips (max 3) emitted by the AI
    quickReplies: { type: [String], default: undefined },
    // Structured UI blocks (cards, carousels, forms, link previews) rendered by
    // the widget alongside or instead of plain content. Stored as Mixed for
    // schema flexibility — block types are validated in app code.
    blocks: { type: [Schema.Types.Mixed], default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ organizationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, role: 1 });

export type MessageDocType = InferSchemaType<typeof messageSchema>;
export const Message: Model<MessageDocType> =
  mongoose.models.Message ?? mongoose.model("Message", messageSchema);
