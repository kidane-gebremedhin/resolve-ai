import { Connection } from "../models/index.js";
import { getAdapter } from "../services/integrations/adapters/index.js";
import type { OAuthAppCreds, ProviderAdapter } from "../services/integrations/providers/types.js";
import { getOAuthAppCreds } from "../services/integrations/oauthApp.service.js";
import { encrypt, decrypt } from "../services/security/crypto.service.js";
import { logger } from "../config/logger.js";

type EncBlob = Parameters<typeof decrypt>[0];

// Refresh one encrypted credential blob if its access token is within the expiry
// window. Returns the newly-encrypted blob + expiry, or null when there's nothing
// to do (not near expiry, unreadable, or the provider rejected the refresh).
async function refreshBlobIfExpiring(
  adapter: ProviderAdapter,
  provider: string,
  blob: EncBlob,
  thresholdMs: number,
  isActive: boolean,
  app: OAuthAppCreds | null,
): Promise<{ enc: EncBlob; expiresAt?: Date } | null> {
  // Only refresh when actually near expiry — avoids needlessly rotating the refresh
  // token (providers like Atlassian invalidate the previous one on every refresh).
  try {
    const creds = JSON.parse(decrypt(blob)) as { expiresAt?: number };
    const expMs = creds.expiresAt ? creds.expiresAt * 1000 : 0;
    if (expMs && expMs > thresholdMs) return null;
  } catch {
    return null; // can't read this slot — leave it alone
  }
  const refreshed = await adapter.refreshTokens(blob, app);
  if (!refreshed) {
    // A dead INACTIVE slot (e.g. a disconnected/expired test account) can't refresh
    // and would otherwise warn every sweep — log it at debug. An ACTIVE-slot failure
    // means the live connection is about to break, so keep that at warn.
    if (isActive) logger.warn("[oauth-refresh] active-slot refresh failed", { provider });
    else logger.debug?.("[oauth-refresh] inactive-slot refresh failed (expected if disconnected)", { provider });
    return null;
  }
  return {
    enc: encrypt(JSON.stringify(refreshed)) as EncBlob,
    expiresAt: refreshed.expiresAt ? new Date(refreshed.expiresAt * 1000) : undefined,
  };
}

export async function refreshExpiringSoon(): Promise<void> {
  const thresholdMs = Date.now() + 10 * 60 * 1000; // 10 min from now
  const threshold = new Date(thresholdMs);

  // Select OAuth connections whose ACTIVE token is expiring, OR that hold BOTH
  // environment slots. Dual-env connections are swept every run because the INACTIVE
  // slot's expiry isn't tracked on the connection document — the per-slot check below
  // only actually refreshes a slot that's near expiry, so this isn't wasteful. Without
  // this, the inactive environment's token silently rots and switching to it later
  // loads a dead, already-rotated refresh token (the "couldn't file a ticket" bug).
  const connections = await Connection.find({
    authMode: "oauth",
    status: "active",
    $or: [
      { expiresAt: { $lt: threshold } },
      { sandboxCredentials: { $exists: true }, productionCredentials: { $exists: true } },
    ],
  }).lean();

  if (connections.length === 0) return;

  await Promise.allSettled(
    connections.map(async (conn) => {
      const adapter = getAdapter(conn.provider);
      if (!adapter) return;

      const c = conn as {
        sandbox?: boolean;
        encryptedCredentials?: EncBlob;
        sandboxCredentials?: EncBlob;
        productionCredentials?: EncBlob;
      };
      const activeSlot = c.sandbox ? "sandboxCredentials" : "productionCredentials";
      const inactiveSlot = c.sandbox ? "productionCredentials" : "sandboxCredentials";
      const set: Record<string, unknown> = {};

      // The operator's OAuth app credentials (client_id/secret) — now PER ENVIRONMENT,
      // since sandbox and production can be separate OAuth apps. Each slot is refreshed
      // with its own environment's app. No app for an environment → that slot can't be
      // refreshed (it just can't stay alive until the operator configures one).
      const activeSandbox = Boolean(c.sandbox);
      const appActive = await getOAuthAppCreds(conn.organizationId, conn.provider, activeSandbox);
      const appInactive = await getOAuthAppCreds(conn.organizationId, conn.provider, !activeSandbox);

      // Active environment — the authoritative `encryptedCredentials` mirror. Keep the
      // active slot in sync so a later env switch can't restore a stale/rotated token.
      if (c.encryptedCredentials && appActive) {
        const res = await refreshBlobIfExpiring(adapter, conn.provider, c.encryptedCredentials, thresholdMs, true, appActive);
        if (res) {
          set.encryptedCredentials = res.enc;
          set[activeSlot] = res.enc;
          if (res.expiresAt) set.expiresAt = res.expiresAt;
        }
      }

      // Inactive environment slot — refreshed independently so BOTH environments stay
      // valid and switching between them is always safe (Changelog 5, Option A).
      const inactiveBlob = c[inactiveSlot];
      if (inactiveBlob && appInactive) {
        const res = await refreshBlobIfExpiring(adapter, conn.provider, inactiveBlob, thresholdMs, false, appInactive);
        if (res) set[inactiveSlot] = res.enc;
      }

      if (Object.keys(set).length > 0) {
        await Connection.updateOne({ _id: conn._id }, { $set: set });
        logger.info("[oauth-refresh] token refreshed", {
          connectionId: conn._id,
          provider: conn.provider,
          slots: Object.keys(set).filter((k) => k.endsWith("Credentials")),
        });
      }
    }),
  );
}

export function startOAuthTokenRefresh(): void {
  // Run every 5 minutes
  setInterval(() => {
    refreshExpiringSoon().catch((err) => {
      logger.error("[oauth-refresh] job failed", { err: (err as Error).message });
    });
  }, 5 * 60 * 1000);

  // Also run once immediately on startup
  refreshExpiringSoon().catch(() => undefined);
}
