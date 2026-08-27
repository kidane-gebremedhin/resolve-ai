import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// One row per payment attempt at the provider, as opposed to `Subscription`,
// which only ever holds the CURRENT state of the entitlement. A subscription
// tells you what the customer is entitled to right now; this tells you what
// they were actually charged, when, whether it went through, and what the
// provider said about it.
//
// `rawPayload` is deliberately the whole webhook event, not a trimmed copy.
// When a customer disputes a charge months later, the argument is settled by
// what the provider actually sent us at the time, not by our interpretation of
// it. Storage is cheap; a reconstructed guess is not evidence.
const paymentSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    // Nullable: a one-off transaction (or one whose subscription link has not
    // landed yet — Paddle can send `transaction.*` before `subscription_id` is
    // populated) still deserves a row.
    subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription" },
    provider: { type: String, enum: ["paddle"], required: true, default: "paddle" },
    // The provider's transaction id. Unique, and the key every write upserts on,
    // which is what makes replayed or out-of-order deliveries converge on one row.
    providerTransactionId: { type: String, required: true, unique: true },
    providerInvoiceId: { type: String },
    status: {
      type: String,
      enum: [
        "pending",
        "completed",
        "failed",
        "refunded",
        "partially_refunded",
        "disputed",
      ],
      required: true,
    },
    // Minor units (cents), matching how Paddle reports money. Never a float:
    // `amount` is summed and compared, and 0.1 + 0.2 is not 0.3.
    amount: { type: Number, required: true, default: 0 },
    currency: { type: String, required: true, default: "USD" },
    tax: { type: Number },
    discount: { type: Number },
    couponCode: { type: String },
    billingPeriod: {
      start: { type: Date },
      end: { type: Date },
    },
    paymentMethod: {
      // `type` here is a plain string field, not a schema type declaration —
      // the nested object form is required to stop mongoose reading it as one.
      type: { type: String },
      last4: { type: String },
      brand: { type: String },
    },
    invoiceUrl: { type: String },
    receiptUrl: { type: String },
    failureReason: { type: String },
    // When the provider says it happened, which is not when we processed it.
    // Ordering by this is what makes a billing history read correctly after a
    // delayed or replayed delivery.
    occurredAt: { type: Date, required: true },
    // The last event we applied to this row, so an out-of-order delivery can be
    // recognised and ignored rather than overwriting a newer state.
    lastEventType: { type: String },
    lastEventOccurredAt: { type: Date },
    // Set when a refund or chargeback lands against this transaction. Kept
    // beside `rawPayload` rather than replacing it: a dispute is argued from
    // both the original charge and the adjustment that followed it.
    adjustment: {
      id: { type: String },
      action: { type: String },
      type: { type: String },
      reason: { type: String },
      amount: { type: Number },
      occurredAt: { type: Date },
      raw: { type: Schema.Types.Mixed },
    },
    rawPayload: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

// Billing history: newest first, scoped to one org.
paymentSchema.index({ organizationId: 1, occurredAt: -1 });
// Dunning and reconciliation sweeps read by status.
paymentSchema.index({ organizationId: 1, status: 1 });

export type PaymentDocType = InferSchemaType<typeof paymentSchema>;
export const Payment: Model<PaymentDocType> =
  mongoose.models.Payment ?? mongoose.model("Payment", paymentSchema);
