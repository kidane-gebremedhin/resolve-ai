import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const organizationSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    plan: { type: String, enum: ["free", "starter", "pro", "enterprise"], required: true, default: "free" },
    paddleCustomerId: { type: String },
    paddleSubscriptionId: { type: String },
    settings: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

organizationSchema.index({ paddleCustomerId: 1 }, { unique: true, sparse: true });

export type OrganizationDocType = InferSchemaType<typeof organizationSchema>;
export const Organization: Model<OrganizationDocType> =
  mongoose.models.Organization ?? mongoose.model("Organization", organizationSchema);
