import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const guardrailsSchema = new Schema(
  {
    // Amount / refund limits (refund_payment, issue_refund)
    maxAmount: { type: Number },
    maxDaysSincePurchase: { type: Number },
    requireIdentityVerification: { type: Boolean, default: false },
    allowedContactEmails: [{ type: String }],
    // Booking window (book_meeting): only allow slots inside business hours.
    // Times are "HH:MM" (24h) in `businessHoursTz`; days are 0=Sun … 6=Sat.
    businessHoursStart: { type: String },
    businessHoursEnd: { type: String },
    businessDays: [{ type: Number }],
    businessHoursTz: { type: String },
    // book_meeting: require a real attendee name (not blank / a placeholder).
    requireNamedAttendee: { type: Boolean, default: false },
    // Subscription changes (upgrade/downgrade): only allow moving to a plan at or
    // above the current one (i.e. block downgrades through the AI).
    upgradeOnly: { type: Boolean, default: false },
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
