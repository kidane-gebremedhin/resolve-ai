import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const widgetSettingsSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    title: { type: String },
    subtitle: { type: String },
    welcomeMessage: { type: String },
    suggestedQuestions: { type: [String], default: [] },
    primaryColor: { type: String },
    position: {
      type: String,
      enum: ["bottom-right", "bottom-left", "centered"],
      default: "bottom-right",
    },
    theme: { type: String, enum: ["light", "dark", "auto"], default: "light" },
    showBranding: { type: Boolean, default: true },
    avatarUrl: { type: String },
    offlineMessage: { type: String },
    requireContactBeforeChat: { type: Boolean, default: false },
  },
  { timestamps: true },
);

widgetSettingsSchema.index({ organizationId: 1, agentId: 1 }, { unique: true });

export type WidgetSettingsDocType = InferSchemaType<typeof widgetSettingsSchema>;
export const WidgetSettings: Model<WidgetSettingsDocType> =
  mongoose.models.WidgetSettings ?? mongoose.model("WidgetSettings", widgetSettingsSchema);
