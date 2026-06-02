import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const websiteSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    name: { type: String, required: true },
    domain: { type: String, required: true, lowercase: true, trim: true },
    allowedOrigins: { type: [String], required: true, default: [] },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

websiteSchema.index({ organizationId: 1 });
websiteSchema.index({ organizationId: 1, domain: 1 }, { unique: true });

export type WebsiteDocType = InferSchemaType<typeof websiteSchema>;
export const Website: Model<WebsiteDocType> =
  mongoose.models.Website ?? mongoose.model("Website", websiteSchema);
