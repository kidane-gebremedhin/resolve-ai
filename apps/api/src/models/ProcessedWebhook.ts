import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Idempotency ledger for inbound provider webhooks (Paddle). We record each
// processed event id so retried deliveries are no-ops. Rows expire after 30
// days via a TTL index — well beyond any provider's retry window.
const processedWebhookSchema = new Schema(
  {
    provider: { type: String, required: true, default: "paddle" },
    eventId: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
  },
  { versionKey: false },
);

export type ProcessedWebhookDocType = InferSchemaType<typeof processedWebhookSchema>;
export const ProcessedWebhook: Model<ProcessedWebhookDocType> =
  mongoose.models.ProcessedWebhook ??
  mongoose.model("ProcessedWebhook", processedWebhookSchema);
