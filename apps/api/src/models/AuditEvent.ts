import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Append-only audit trail. Every operator-level mutation should write a row
// here so that admins can answer "who did what?" via the Audit tab in
// Settings. We keep it generic — `action` is a free-form string (loosely
// enum-like) and `metadata` is Mixed so each call-site can attach whatever
// is most useful for the UI. Indexes are tuned for the dashboard query
// (newest-first by org, optionally filtered by user/action).
const auditEventSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    action: { type: String, required: true },
    target: { type: String },
    metadata: { type: Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditEventSchema.index({ organizationId: 1, createdAt: -1 });
auditEventSchema.index({ organizationId: 1, userId: 1, createdAt: -1 });
auditEventSchema.index({ organizationId: 1, action: 1 });

export type AuditEventDocType = InferSchemaType<typeof auditEventSchema>;
export const AuditEvent: Model<AuditEventDocType> =
  mongoose.models.AuditEvent ?? mongoose.model("AuditEvent", auditEventSchema);
