import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const widgetSettingsSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    welcomeMessage: { type: String },
    suggestedQuestions: { type: [String], default: [] },
    primaryColor: { type: String },
    // Header background treatment. "pinstripe" = the lavender/blue diagonal-pinstripe pattern
    // (the default look, independent of primaryColor). "solid" = a solid header in the operator's
    // accent (primaryColor). Kept separate from primaryColor so a solid accent (e.g. #1e40af) is
    // its own option and never conflated with the pattern.
    headerStyle: { type: String, enum: ["pinstripe", "solid"], default: "pinstripe" },
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
