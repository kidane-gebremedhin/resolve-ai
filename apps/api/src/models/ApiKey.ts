import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Per-organization API keys for programmatic access. The plaintext key
// (`csb_<random>`) is shown to the user EXACTLY ONCE at creation time —
// only a sha256 hash is stored here. `prefix` is the first 8 chars of the
// plaintext, kept verbatim so the UI can render a recognisable handle and
// so verification can do a cheap indexed lookup before the hash compare.
const apiKeySchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true },
    prefix: { type: String, required: true, index: true },
    keyHash: { type: String, required: true },
    scopes: { type: [String], default: ["read"] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
    expiresAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

apiKeySchema.index({ organizationId: 1, revokedAt: 1 });

export type ApiKeyDocType = InferSchemaType<typeof apiKeySchema>;
export const ApiKey: Model<ApiKeyDocType> =
  mongoose.models.ApiKey ?? mongoose.model("ApiKey", apiKeySchema);
