import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const subscriptionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, unique: true },
    paddleSubscriptionId: { type: String, required: true, unique: true },
    paddleCustomerId: { type: String, required: true },
    plan: { type: String, enum: ["starter", "pro", "enterprise"], required: true },
    status: {
      type: String,
      enum: ["active", "trialing", "past_due", "canceled", "paused"],
      required: true,
    },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    canceledAt: { type: Date },
    trialEndAt: { type: Date },
    paddleData: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

subscriptionSchema.index({ status: 1 });

export type SubscriptionDocType = InferSchemaType<typeof subscriptionSchema>;
export const Subscription: Model<SubscriptionDocType> =
  mongoose.models.Subscription ?? mongoose.model("Subscription", subscriptionSchema);
