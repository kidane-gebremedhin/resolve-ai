import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { PLAN_KEYS } from "../config/plans.js";

// Lifetime-deal (LTD) coupon — the kind handed to AppSumo / PitchGround /
// StackSocial buyers. Redeeming one upgrades the redeemer's ORGANIZATION
// directly; it is NOT a checkout discount and never touches Paddle.
//
// Entitlement in this codebase is org-scoped (Organization.plan, mirrored from
// Subscription), so `grantsTier` uses the real plan values — there is no
// "lifetime" tier to invent. What makes the grant lifetime is the subscription
// period end the redemption writes, not a separate tier.
const couponSchema = new Schema(
  {
    // Stored and compared UPPERCASE. `uppercase: true` normalises on every set,
    // so the unique index can't be defeated by casing.
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    grantsTier: { type: String, enum: PLAN_KEYS, required: true },
    // Total uses allowed across all orgs. The atomic claim in coupon.service
    // compares this against `redemptionsCount` inside a single conditional write.
    maxRedemptions: { type: Number, required: true, min: 1 },
    redemptionsCount: { type: Number, required: true, default: 0, min: 0 },
    maxPerUser: { type: Number, required: true, default: 1, min: 1 },
    validFrom: { type: Date, required: true, default: Date.now },
    // null = never expires.
    validUntil: { type: Date, default: null },
    // Manual kill switch, independent of dates and capacity.
    isActive: { type: Boolean, required: true, default: true },
    partner: { type: String, trim: true },
    campaign: { type: String, trim: true },
    /** Shown to the redeemer on validate. */
    description: { type: String },
    /** NEVER serialised to a non-admin — see toPublicCoupon() in coupon.service. */
    internalNotes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// `code` already carries a unique index from the field definition above.
couponSchema.index({ partner: 1 });
couponSchema.index({ grantsTier: 1 });
couponSchema.index({ isActive: 1 });
// Supports the validity-window scan on the admin list.
couponSchema.index({ validFrom: 1, validUntil: 1 });

export type CouponDocType = InferSchemaType<typeof couponSchema>;
export const Coupon: Model<CouponDocType> =
  mongoose.models.Coupon ?? mongoose.model("Coupon", couponSchema);
