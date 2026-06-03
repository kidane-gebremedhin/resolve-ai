import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Admin-created marketing campaign. New signups that arrive with `?campaign=<code>`
// are attributed to it (Organization.campaignCode), which drives the campaign
// analytics (signups + paid conversions).
const campaignSchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    channel: {
      type: String,
      enum: ["email", "social", "ads", "referral", "content", "other"],
      default: "other",
    },
    status: { type: String, enum: ["active", "paused", "ended"], default: "active" },
    description: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

campaignSchema.index({ status: 1 });

export type CampaignDocType = InferSchemaType<typeof campaignSchema>;
export const Campaign: Model<CampaignDocType> =
  mongoose.models.Campaign ?? mongoose.model("Campaign", campaignSchema);
