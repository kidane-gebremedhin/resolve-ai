import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// One row per referred organization. Tracks attribution (who referred it) and
// the commission lifecycle: pending → earned (org bought a paid plan) → paid
// (admin paid out), or void (window elapsed without conversion).
const referralSchema = new Schema(
  {
    referrerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    referredOrganizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      unique: true,
    },
    referredUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "earned", "paid", "void"],
      required: true,
      default: "pending",
    },
    plan: { type: String },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription" },
    commissionCents: { type: Number, default: 0 },
    commissionRate: { type: Number, default: 0 },
    earnedAt: { type: Date },
    paidAt: { type: Date },
    payoutRef: { type: String },
  },
  { timestamps: true },
);

referralSchema.index({ referrerUserId: 1, status: 1 });

export type ReferralDocType = InferSchemaType<typeof referralSchema>;
export const Referral: Model<ReferralDocType> =
  mongoose.models.Referral ?? mongoose.model("Referral", referralSchema);
