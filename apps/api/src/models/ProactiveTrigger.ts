import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface ProactiveTriggerDocType extends Document {
  organizationId: mongoose.Types.ObjectId;
  agentId: mongoose.Types.ObjectId;
  name: string;
  isActive: boolean;
  conditions: Array<{
    type: "time_on_page" | "scroll_depth" | "exit_intent" | "url_match" | "element_hover";
    params: Record<string, unknown>;
  }>;
  conditionLogic: "AND" | "OR";
  message: string;
  delayMs: number;
  cooldownMs: number;
  maxFires: number;
  createdAt: Date;
  updatedAt: Date;
}

const ConditionSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["time_on_page", "scroll_depth", "exit_intent", "url_match", "element_hover"],
      required: true,
    },
    params: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const ProactiveTriggerSchema = new Schema<ProactiveTriggerDocType>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
    agentId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    conditions: { type: [ConditionSchema], default: [] },
    conditionLogic: { type: String, enum: ["AND", "OR"], default: "AND" },
    message: { type: String, required: true },
    delayMs: { type: Number, default: 0 },
    cooldownMs: { type: Number, default: 86_400_000 }, // 24h
    maxFires: { type: Number, default: 1 },
  },
  { timestamps: true },
);

export const ProactiveTrigger: Model<ProactiveTriggerDocType> =
  (mongoose.models.ProactiveTrigger as Model<ProactiveTriggerDocType>) ??
  mongoose.model<ProactiveTriggerDocType>("ProactiveTrigger", ProactiveTriggerSchema);
