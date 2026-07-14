import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Per-organization OAuth *application* credentials (client_id / client_secret) for a
// provider — so each operator brings their own registered OAuth app instead of a
// single set of credentials hardcoded in the server's environment. The client_secret
// is encrypted at rest (AES-256-GCM) in the same vault as connection credentials; the
// client_id is public (it appears in the authorization URL) so it's stored plaintext
// for display.
const encryptedBlobSchema = new Schema(
  {
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
    authTag: { type: String, required: true },
    keyVersion: { type: Number, required: true, default: 1 },
  },
  { _id: false },
);

const oauthAppConfigSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    provider: { type: String, required: true }, // jira | calendly | linear | shopify | stripe
    // Which environment this app is for. Sandbox and production are usually SEPARATE
    // OAuth apps (e.g. Stripe test vs live, or two Atlassian apps), so each has its own
    // client id/secret. Defaults to production.
    sandbox: { type: Boolean, required: true, default: false },
    clientId: { type: String, required: true }, // public — shown in the UI
    // Optional — the OAuth app config now collects only a Client ID by default. When a
    // secret is present it's encrypted at rest and used as the confidential-client
    // secret at token exchange; some flows connect with just the Client ID.
    encryptedClientSecret: { type: encryptedBlobSchema },
    // Optional per-app redirect URI override (must match what's registered with the
    // provider); defaults to `${API_BASE_URL}/api/v1/integrations/<provider>/callback`.
    redirectUri: { type: String },
    // Provider-specific extras that aren't secret (e.g. Shopify shop domain).
    extra: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// One app config per (org, provider, environment).
oauthAppConfigSchema.index({ organizationId: 1, provider: 1, sandbox: 1 }, { unique: true });

export type OAuthAppConfigDocType = InferSchemaType<typeof oauthAppConfigSchema>;
export const OAuthAppConfig: Model<OAuthAppConfigDocType> =
  mongoose.models.OAuthAppConfig ?? mongoose.model("OAuthAppConfig", oauthAppConfigSchema);
