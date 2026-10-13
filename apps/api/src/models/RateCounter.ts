import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Fixed-window counters shared by every API replica (an in-memory map gave each
// replica its own budget, so N replicas allowed N times the configured limit).
const rateCounterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, required: true },
  resetAt: { type: Date, required: true },
});

// Expired windows are removed by MongoDB.
rateCounterSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export type RateCounterDocType = InferSchemaType<typeof rateCounterSchema>;
export const RateCounter: Model<RateCounterDocType> =
  mongoose.models.RateCounter ?? mongoose.model("RateCounter", rateCounterSchema);
