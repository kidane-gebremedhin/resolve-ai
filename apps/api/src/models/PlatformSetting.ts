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
    // Admin-editable plan catalog overrides (display fields only; quota limits
    // stay code-driven). Empty → code defaults from config/plans.ts.
    plans: {
      type: [
        new Schema(
          {
            plan: { type: String, enum: ["pro", "business", "enterprise"], required: true },
            name: { type: String },
            priceMonthlyUsd: { type: Number, default: null },
            features: { type: [String], default: undefined },
            priceId: { type: String },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    // Affiliate / referral program config.
    affiliate: new Schema(
      {
        enabled: { type: Boolean, default: true },
        ratePercent: { type: Number, default: 20 },
        cookieDays: { type: Number, default: 60 },
      },
      { _id: false },
    ),
    // Global app typography. Keys map to the curated next/font registry in
    // apps/web/src/app/fonts.ts (one of ~100 self-hosted Google fonts). Defaults
    // reproduce the Inter / Inter Tight look.
    theming: new Schema(
      {
        fontSans: { type: String, default: "inter" },
        fontDisplay: { type: String, default: "inter-tight" },
      },
      { _id: false },
    ),
    // Admin-configurable USD spending caps per plan. 0 = unlimited.
    // Falls back to DEFAULT_BUDGET_LIMITS in config/plans.ts when empty.
    budgetLimits: {
      type: [
        new Schema(
          {
            plan: { type: String, enum: ["pro", "business", "enterprise"], required: true },
            orgMonthlyLimitUsd: { type: Number, default: 0 },
            websiteMonthlyLimitUsd: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type PlatformSettingDocType = InferSchemaType<typeof platformSettingSchema>;
export const PlatformSetting: Model<PlatformSettingDocType> =
  mongoose.models.PlatformSetting ??
  mongoose.model("PlatformSetting", platformSettingSchema);
