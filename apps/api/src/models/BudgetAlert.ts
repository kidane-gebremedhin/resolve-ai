import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Tracks which budget threshold alert emails have already been sent so that
// we never send the same threshold notification twice in one billing period.
const budgetAlertSchema = new Schema(
  {
    entityType: { type: String, enum: ["org", "website"], required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    period: { type: String, required: true }, // YYYY-MM
    threshold: { type: Number, enum: [50, 75, 100], required: true },
    sentAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

// Unique constraint: one alert per entity × period × threshold.
budgetAlertSchema.index({ entityId: 1, period: 1, threshold: 1 }, { unique: true });
// TTL: keep alert records for 3 months then auto-delete.
budgetAlertSchema.index({ sentAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export type BudgetAlertDocType = InferSchemaType<typeof budgetAlertSchema>;
export const BudgetAlert: Model<BudgetAlertDocType> =
  mongoose.models.BudgetAlert ?? mongoose.model("BudgetAlert", budgetAlertSchema);
