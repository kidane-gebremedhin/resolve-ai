import { Connection } from "../models/index.js";
import { getAdapter } from "../services/integrations/adapters/index.js";
import { encrypt, decrypt } from "../services/security/crypto.service.js";
import { logger } from "../config/logger.js";

async function refreshExpiringSoon(): Promise<void> {
  const threshold = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now

  const connections = await Connection.find({
    authMode: "oauth",
    status: "active",
    expiresAt: { $lt: threshold },
  }).lean();

  if (connections.length === 0) return;

  logger.info("[oauth-refresh] refreshing tokens", { count: connections.length });

  await Promise.allSettled(
    connections.map(async (conn) => {
      const adapter = getAdapter(conn.provider);
      if (!adapter) return;

      const freshCreds = await adapter.refreshTokens(conn.encryptedCredentials as Parameters<typeof decrypt>[0]);
      if (!freshCreds) {
        logger.warn("[oauth-refresh] adapter returned null, skipping", { provider: conn.provider });
        return;
      }

      const encrypted = encrypt(JSON.stringify(freshCreds));
      const expiresAt = freshCreds.expiresAt ? new Date(freshCreds.expiresAt * 1000) : undefined;

      await Connection.updateOne(
        { _id: conn._id },
        { $set: { encryptedCredentials: encrypted, ...(expiresAt ? { expiresAt } : {}) } },
      );

      logger.info("[oauth-refresh] token refreshed", { connectionId: conn._id, provider: conn.provider });
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
