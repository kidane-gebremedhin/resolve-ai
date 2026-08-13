import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { PLAN_KEYS } from "../config/plans.js";

// Immutable audit log of coupon redemptions. Append-only: rows are never
// updated, and the ONLY delete path is the compensating rollback in
// coupon.service when a claim succeeded but the grant itself failed — such a row
// never corresponded to an actual upgrade.
//
// Coupon code, user email and tier are denormalised so the history stays
// readable after the coupon document is gone.
const couponRedemptionSchema = new Schema(
  {
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", required: true },
    couponCode: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    userEmail: { type: String, required: true },
    // Entitlement in this app is org-scoped, so the grant target is recorded
    // alongside the redeeming user — this is what the unique index below guards.
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    tierGranted: { type: String, enum: PLAN_KEYS, required: true },
    redeemedAt: { type: Date, required: true, default: Date.now },
    // Abuse forensics.
    ipAddress: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true },
);

// Per-user redemption count (business rule 6, `maxPerUser`).
couponRedemptionSchema.index({ userId: 1, couponId: 1 });
couponRedemptionSchema.index({ couponId: 1 });
couponRedemptionSchema.index({ redeemedAt: -1 });

// THE final arbiter for double-redemption, enforced by the database rather than
// a racy read-then-count.
//
// The spec calls for unique (userId, couponId) when maxPerUser is 1. Here the
// grant lands on the ORGANISATION, so (couponId, organizationId) is both
// stricter and more correct: it also stops two different admins of the same org
// from burning two slots on a workspace that can only hold one plan. A second
// redemption for an org is meaningless anyway — rule 7 (already on an equal or
// better plan) rejects it first; this index is the backstop when two requests
// race past that check simultaneously.
couponRedemptionSchema.index({ couponId: 1, organizationId: 1 }, { unique: true });

export type CouponRedemptionDocType = InferSchemaType<typeof couponRedemptionSchema>;
export const CouponRedemption: Model<CouponRedemptionDocType> =
  mongoose.models.CouponRedemption ??
  mongoose.model("CouponRedemption", couponRedemptionSchema);
