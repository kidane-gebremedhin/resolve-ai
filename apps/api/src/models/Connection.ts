import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const encryptedBlobSchema = new Schema(
  {
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
    authTag: { type: String, required: true },
    keyVersion: { type: Number, required: true, default: 1 },
  },
  { _id: false },
);

const connectionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    provider: { type: String, required: true },
    name: { type: String, required: true },
    // Operator-authored note shown in the UI and passed to the AI as guidance on
    // when to use this connection's tools (e.g. "use when the customer wants sales").
    description: { type: String },
    authMode: { type: String, enum: ["oauth", "api_key", "webhook"], required: true },
    status: {
      type: String,
      enum: ["active", "error", "revoked"],
      required: true,
      default: "active",
    },
    sandbox: { type: Boolean, required: true, default: true },
    // Per-connection rate limits for AI tool calls (sliding window). perSession
    // caps one visitor; perConnection caps all visitors combined (0 = no cap).
    rateLimitPerSession: { type: Number, default: 10 },
    rateLimitPerConnection: { type: Number, default: 0 },
    rateLimitWindowMs: { type: Number, default: 60_000 },
    // Active credentials the dispatcher uses (mirror of the current environment's
    // slot below). Kept for backward compatibility.
    encryptedCredentials: { type: encryptedBlobSchema, required: true },
    // Per-environment credentials so an operator can connect BOTH sandbox and
    // production keys and switch the `sandbox` flag without re-entering them.
    // Toggling copies the matching slot into encryptedCredentials.
    sandboxCredentials: { type: encryptedBlobSchema },
    productionCredentials: { type: encryptedBlobSchema },
    scopes: [{ type: String }],
    expiresAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

connectionSchema.index({ organizationId: 1, provider: 1 });

export type ConnectionDocType = InferSchemaType<typeof connectionSchema>;
export const Connection: Model<ConnectionDocType> =
  mongoose.models.Connection ?? mongoose.model("Connection", connectionSchema);
