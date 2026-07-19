import type { Types } from "mongoose";
import { OAuthAppConfig } from "../../models/index.js";
import { encrypt, decrypt } from "../security/crypto.service.js";
import type { OAuthAppCreds } from "./providers/types.js";
import { logger } from "../../config/logger.js";

// Providers that authenticate via OAuth and therefore need a per-org app config.
export const OAUTH_PROVIDERS = ["jira", "calendly", "linear", "shopify", "stripe"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(provider: string): provider is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Fetch + decrypt the operator's OAuth app credentials for a provider. Returns null
 * when the operator hasn't configured one — callers surface a "configure your OAuth
 * app first" error instead of falling back to any hardcoded environment credentials.
 */
export async function getOAuthAppCreds(
  organizationId: string | Types.ObjectId,
  provider: string,
  sandbox: boolean,
): Promise<OAuthAppCreds | null> {
  // Prefer the exact environment's app; fall back to ANY config for this provider so
  // a single legacy/pre-per-env app keeps working for both environments until the
  // operator adds a separate one.
  let cfg = await OAuthAppConfig.findOne({ organizationId, provider, sandbox }).lean();
  if (!cfg) cfg = await OAuthAppConfig.findOne({ organizationId, provider }).lean();
  if (!cfg?.clientId) return null;
  // The Client ID is the only required value. Decrypt the secret only when one is
  // stored — some apps are configured with just a Client ID.
  let clientSecret: string | undefined;
  if (cfg.encryptedClientSecret) {
    try {
      clientSecret = decrypt(cfg.encryptedClientSecret as Parameters<typeof decrypt>[0]);
    } catch (err) {
      logger.error("[oauth-app] failed to decrypt client secret", { provider, err: (err as Error).message });
    }
  }
  return {
    clientId: cfg.clientId,
    clientSecret,
    redirectUri: cfg.redirectUri ?? undefined,
    extra: (cfg.extra as Record<string, unknown> | undefined) ?? undefined,
  };
}

/** Upsert an operator's OAuth app config for a provider + environment (secret encrypted). */
export async function saveOAuthApp(
  organizationId: string | Types.ObjectId,
  provider: string,
  sandbox: boolean,
  input: { clientId: string; clientSecret: string; redirectUri?: string; extra?: Record<string, unknown> },
  createdBy?: string | Types.ObjectId,
): Promise<void> {
  const $set: Record<string, unknown> = { clientId: input.clientId.trim() };
  // Only replace the secret when a new one is provided (blank = keep existing).
  if (input.clientSecret && input.clientSecret.trim()) {
    $set.encryptedClientSecret = encrypt(input.clientSecret.trim());
  }
  if (input.redirectUri !== undefined) $set.redirectUri = input.redirectUri.trim() || undefined;
  if (input.extra !== undefined) $set.extra = input.extra;
  await OAuthAppConfig.updateOne(
    { organizationId, provider, sandbox },
    { $set, $setOnInsert: { organizationId, provider, sandbox, ...(createdBy ? { createdBy } : {}) } },
    { upsert: true },
  );
}

/** Which environments have an OAuth app configured for each provider — for the UI. */
export async function getOAuthAppEnvMap(
  organizationId: string | Types.ObjectId,
): Promise<Map<string, { sandbox: boolean; production: boolean }>> {
  const cfgs = await OAuthAppConfig.find({ organizationId }, { provider: 1, sandbox: 1, clientId: 1 }).lean();
  const map = new Map<string, { sandbox: boolean; production: boolean }>();
  for (const c of cfgs) {
    if (!c.clientId) continue;
    const cur = map.get(c.provider) ?? { sandbox: false, production: false };
    if (c.sandbox) cur.sandbox = true;
    else cur.production = true;
    map.set(c.provider, cur);
  }
  return map;
}
