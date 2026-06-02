import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Singleton document holding platform-wide configuration. Keyed by
// `singleton: 'global'` so we can always upsert against a stable filter.
// Secrets (e.g. SMTP password) should be encrypted at rest — kept as a plain
// string field for now with a TODO so the future encryption layer has a
// concrete home.
const platformSettingSchema = new Schema(
  {
    singleton: { type: String, default: "global", unique: true, required: true },
    smtp: new Schema(
      {
        host: { type: String, default: "" },
        port: { type: Number, default: 587 },
        username: { type: String, default: "" },
        // TODO: encrypt at rest. Stored as plaintext for now; do not log.
        secret: { type: String, default: "" },
        fromEmail: { type: String, default: "" },
      },
      { _id: false },
    ),
    security: new Schema(
      {
        mfaRequired: { type: Boolean, default: false },
        sessionTimeoutMinutes: { type: Number, default: 60 * 24 },
        ipAllowlist: { type: [String], default: [] },
      },
      { _id: false },
    ),
    limits: new Schema(
      {
        maxOrgsPerUser: { type: Number, default: 5 },
        defaultRateLimitPerMinute: { type: Number, default: 600 },
      },
      { _id: false },
    ),
    branding: new Schema(
      {
        platformName: { type: String, default: "Customer Service Chatbot" },
        supportEmail: { type: String, default: "" },
      },
      { _id: false },
    ),
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type PlatformSettingDocType = InferSchemaType<typeof platformSettingSchema>;
export const PlatformSetting: Model<PlatformSettingDocType> =
  mongoose.models.PlatformSetting ??
  mongoose.model("PlatformSetting", platformSettingSchema);
