import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const membershipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    role: { type: String, enum: ["owner", "admin", "agent", "viewer"], required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User" },
    invitedAt: { type: Date },
    acceptedAt: { type: Date },
    status: {
      type: String,
      enum: ["active", "pending", "revoked"],
      required: true,
      default: "active",
    },
  },
  { timestamps: true },
);

membershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
membershipSchema.index({ organizationId: 1, role: 1 });
membershipSchema.index({ userId: 1, status: 1 });

export type MembershipDocType = InferSchemaType<typeof membershipSchema>;
export const Membership: Model<MembershipDocType> =
  mongoose.models.Membership ?? mongoose.model("Membership", membershipSchema);
