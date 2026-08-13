import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const subscriptionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, unique: true },
    // Paddle identifiers are absent for coupon-granted (lifetime-deal)
    // subscriptions, which never touch the payment provider — hence optional and
    // a SPARSE unique index, so many coupon subscriptions can coexist without
    // colliding on a null `paddleSubscriptionId`. Paddle-sourced rows always set
    // both (see billing.service).
    paddleSubscriptionId: { type: String, unique: true, sparse: true },
    paddleCustomerId: { type: String },
    // How this subscription came to exist. Drives the billing UI: a "coupon" row
    // has no Paddle object behind it, so the customer portal / upgrade / cancel
    // actions must not be offered for it.
    source: { type: String, enum: ["paddle", "coupon"], required: true, default: "paddle" },
    // Provenance for a coupon-granted subscription (null for Paddle rows).
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon" },
    couponCode: { type: String },
    plan: { type: String, enum: ["pro", "business", "enterprise"], required: true },
    status: {
      type: String,
      enum: ["active", "trialing", "past_due", "canceled", "paused"],
      required: true,
    },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    billingInterval: { type: String, enum: ["month", "year"], default: "month" },
    canceledAt: { type: Date },
    // When a cancel-at-period-end is SCHEDULED (Paddle `scheduled_change` with action
    // "cancel"), this holds the date it takes effect while the subscription is still
    // `active`. Cleared when the schedule is removed or the cancel actually happens.
    cancelScheduledAt: { type: Date },
    trialEndAt: { type: Date },
    paddleData: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

subscriptionSchema.index({ status: 1 });

export type SubscriptionDocType = InferSchemaType<typeof subscriptionSchema>;
export const Subscription: Model<SubscriptionDocType> =
  mongoose.models.Subscription ?? mongoose.model("Subscription", subscriptionSchema);
