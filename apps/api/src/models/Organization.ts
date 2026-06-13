import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const organizationSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    plan: { type: String, enum: ["pro", "business", "enterprise"] },
    paddleCustomerId: { type: String },
    paddleSubscriptionId: { type: String },
    // Affiliate attribution: the user whose referral link created this org.
    referredByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    // Marketing attribution: the campaign code (`?campaign=`) present at signup.
    campaignCode: { type: String },
    settings: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

organizationSchema.index({ paddleCustomerId: 1 }, { unique: true, sparse: true });

export type OrganizationDocType = InferSchemaType<typeof organizationSchema>;
export const Organization: Model<OrganizationDocType> =
  mongoose.models.Organization ?? mongoose.model("Organization", organizationSchema);
