import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const contactSessionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    websiteId: { type: Schema.Types.ObjectId, ref: "Website", required: true },
    token: { type: String, required: true, unique: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String },
    name: { type: String },
    metadata: { type: Schema.Types.Mixed },
    ipAddress: { type: String },
    userAgent: { type: String },
    expiresAt: { type: Date, required: true },
    lastActiveAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

contactSessionSchema.index({ organizationId: 1, websiteId: 1 });
contactSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
contactSessionSchema.index({ organizationId: 1, email: 1 });

export type ContactSessionDocType = InferSchemaType<typeof contactSessionSchema>;
export const ContactSession: Model<ContactSessionDocType> =
  mongoose.models.ContactSession ?? mongoose.model("ContactSession", contactSessionSchema);
