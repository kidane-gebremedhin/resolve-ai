import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const sectionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    title: { type: String, required: true },
    description: { type: String },
    icon: { type: String },
    url: { type: String },
    action: { type: String, enum: ["link", "start-chat", "topic"] },
    topicPrompt: { type: String },
    order: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

sectionSchema.index({ organizationId: 1, agentId: 1, order: 1 });

export type SectionDocType = InferSchemaType<typeof sectionSchema>;
export const Section: Model<SectionDocType> =
  mongoose.models.Section ?? mongoose.model("Section", sectionSchema);
