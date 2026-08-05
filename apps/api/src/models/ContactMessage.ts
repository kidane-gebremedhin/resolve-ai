import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Inbound sales/support inquiries from the PUBLIC marketing "Contact Us" form
// (POST /public/contact). Distinct from `ContactSession` (widget visitors tied to
// an org/website) — these are unauthenticated, org-agnostic leads. Persisted so a
// submission is never lost even when SMTP isn't configured; a best-effort support
// email is sent on top.
const contactMessageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    message: { type: String, required: true },
    // Light spam/abuse forensics — never shown in the UI.
    ipAddress: { type: String },
    userAgent: { type: String },
    // Operator triage state for a future admin inbox.
    status: {
      type: String,
      enum: ["new", "read", "archived"],
      required: true,
      default: "new",
    },
  },
  { timestamps: true },
);

contactMessageSchema.index({ createdAt: -1 });

export type ContactMessageDocType = InferSchemaType<typeof contactMessageSchema>;
export const ContactMessage: Model<ContactMessageDocType> =
  mongoose.models.ContactMessage ?? mongoose.model("ContactMessage", contactMessageSchema);
