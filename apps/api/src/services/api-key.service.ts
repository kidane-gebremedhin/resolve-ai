import crypto from "node:crypto";
import { ApiKey } from "../models/index.js";

// API key format: `csb_<32-ish url-safe random chars>`. We use 24 random
// bytes (≈32 base64url chars) which gives 192 bits of entropy — far more
// than enough for a non-rotating bearer secret. Only the sha256 hash is
// persisted; the plaintext is shown to the user EXACTLY ONCE.

const KEY_PREFIX_NS = "csb_";

export interface GeneratedKey {
  key: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedKey {
  const random = crypto.randomBytes(24).toString("base64url");
  const key = `${KEY_PREFIX_NS}${random}`;
  const prefix = key.slice(0, 8);
  const hash = sha256(key);
  return { key, prefix, hash };
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export interface VerifiedKey {
  apiKeyId: string;
  organizationId: string;
  scopes: string[];
}

// Lookup-then-compare: index on `prefix` keeps this cheap, the sha256
// equality on `keyHash` does the actual auth. We also check `revokedAt`
// and `expiresAt` so the call site doesn't have to.
export async function verifyApiKey(presented: string): Promise<VerifiedKey | null> {
  if (!presented || !presented.startsWith(KEY_PREFIX_NS)) return null;
  const prefix = presented.slice(0, 8);
  const hash = sha256(presented);
  const now = new Date();
  const candidate = await ApiKey.findOne({
    prefix,
    keyHash: hash,
    revokedAt: { $in: [null, undefined] },
  });
  if (!candidate) return null;
  if (candidate.expiresAt && candidate.expiresAt.getTime() < now.getTime()) return null;
  // Best-effort last-used touch (fire-and-forget).
  ApiKey.updateOne({ _id: candidate._id }, { $set: { lastUsedAt: now } }).catch(() => {
    /* noop */
  });
  return {
    apiKeyId: candidate._id.toString(),
    organizationId: candidate.organizationId.toString(),
    scopes: (candidate.scopes ?? []) as string[],
  };
}
