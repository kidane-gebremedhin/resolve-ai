import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const guardrailsSchema = new Schema(
  {
    // Amount / refund limits (refund_payment, issue_refund)
    maxAmount: { type: Number },
    maxDaysSincePurchase: { type: Number },
    // Tri-state ON PURPOSE — no schema default. true = require email-OTP; false = the
    // operator explicitly disabled it; absent = the per-tool default applies (the
    // dispatcher requires OTP for subscription-CHANGE tools unless explicitly false).
    // A `default: false` here materialized an explicit false on every tool def, which
    // read as "operator disabled it" and silently turned the default-on OTP off.
    requireIdentityVerification: { type: Boolean },
    allowedContactEmails: [{ type: String }],
    // Booking window (book_meeting): only allow slots inside business hours.
    // Times are "HH:MM" (24h) in `businessHoursTz`; days are 0=Sun … 6=Sat.
    businessHoursStart: { type: String },
    businessHoursEnd: { type: String },
    businessDays: [{ type: Number }],
    businessHoursTz: { type: String },
    // book_meeting: require a real attendee name (not blank / a placeholder).
    // Defaults ON — bookings should capture the customer's real name unless the
    // operator explicitly turns it off (in which case the adapter books under the
    // generic "Customer" attendee).
    requireNamedAttendee: { type: Boolean, default: true },
    // Subscription/refund: only act when the customer is the account's billing owner.
    requireBillingOwner: { type: Boolean, default: false },
  },
  { _id: false },
);

const toolDefinitionSchema = new Schema(
  {
    connectionId: { type: Schema.Types.ObjectId, ref: "Connection", required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    key: { type: String, required: true },
    displayName: { type: String, required: true },
    description: { type: String, required: true },
    jsonSchema: { type: Schema.Types.Mixed, required: true },
    guardrails: { type: guardrailsSchema, default: () => ({}) },
    enabledAgentIds: [{ type: Schema.Types.ObjectId, ref: "Agent" }],
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

toolDefinitionSchema.index({ connectionId: 1, key: 1 }, { unique: true });
toolDefinitionSchema.index({ organizationId: 1, isActive: 1 });

export type ToolDefinitionDocType = InferSchemaType<typeof toolDefinitionSchema>;
export const ToolDefinition: Model<ToolDefinitionDocType> =
  mongoose.models.ToolDefinition ?? mongoose.model("ToolDefinition", toolDefinitionSchema);
