import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// A snapshot of an OPERATOR's OWN customer's subscription, kept in sync by the
// per-connection Paddle/Stripe webhook receiver (see webhookReceiver.ts). This is
// NOT the platform's billing (that's `Subscription`) — it mirrors the subscriptions
// the operator manages in their own Paddle/Stripe account for their customers.
//
// Why store it at all: Paddle/Stripe apply plan changes and lifecycle events
// (renewals, cancellations, payment failures) asynchronously. The widget's live
// API lookup can't see a change the operator made outside the chat, and a
// momentary API outage would otherwise leave the assistant unable to answer a
// simple "what plan am I on?". The receiver writes the latest state here so the
// assistant can answer instantly and reflect out-of-band changes.
const externalSubscriptionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    connectionId: { type: Schema.Types.ObjectId, ref: "Connection", required: true },
    provider: { type: String, required: true }, // "paddle" | "stripe"
    // The customer's account email (lowercased). This is the key the widget resolves
    // by — the assistant looks a customer up by their verified account email.
    customerEmail: { type: String, index: true },
    externalCustomerId: { type: String },
    externalSubscriptionId: { type: String, required: true },
    plan: { type: String },
    status: { type: String },
    priceId: { type: String },
    billingInterval: { type: String }, // "month" | "year"
    currentPeriodEnd: { type: Date },
    canceledAt: { type: Date },
    // The raw provider event that last updated this row, for debugging/audit.
    raw: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

// One row per (connection, subscription). Upserts key off this pair so retried or
// out-of-order events converge on a single, latest snapshot.
externalSubscriptionSchema.index({ connectionId: 1, externalSubscriptionId: 1 }, { unique: true });
// Fast lookup by the customer's email within a connection (the widget's read path).
externalSubscriptionSchema.index({ connectionId: 1, customerEmail: 1 });

export type ExternalSubscriptionDocType = InferSchemaType<typeof externalSubscriptionSchema>;
export const ExternalSubscription: Model<ExternalSubscriptionDocType> =
  mongoose.models.ExternalSubscription ??
  mongoose.model("ExternalSubscription", externalSubscriptionSchema);
