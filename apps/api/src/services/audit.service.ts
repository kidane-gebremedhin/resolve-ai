import type { Request } from "express";
import { AuditEvent } from "../models/index.js";

// Single helper for writing an audit row. Always returns a resolved
// promise even if the insert fails — audit logging must never break the
// caller's request. The trade-off is that a logger failure is silent
// (besides the console.error). For now this is acceptable: the audit
// trail is best-effort, not a transactional guarantee.
export interface LogAuditInput {
  organizationId: string;
  userId?: string | null;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    await AuditEvent.create({
      organizationId: input.organizationId,
      userId: input.userId ?? undefined,
      action: input.action,
      target: input.target,
      metadata: input.metadata,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[audit] failed to write audit event", err);
  }
}

// Convenience helper for routes — pulls org/user/ip/UA off the request so
// callers can keep their handler bodies tidy.
export async function logAuditFromReq(
  req: Request,
  action: string,
  target?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const organizationId = req.orgId ?? req.auth?.organizationId;
  if (!organizationId) return;
  await logAudit({
    organizationId,
    userId: req.auth?.userId,
    action,
    target,
    metadata,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });
}
