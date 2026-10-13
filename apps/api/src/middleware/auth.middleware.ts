import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { UnauthorizedError, ForbiddenError } from "../utils/errors.js";
import { Membership, User } from "../models/index.js";

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header.");
  }
  const token = header.slice("Bearer ".length);
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError("Invalid or expired access token.");
  }
  // The token signature can outlive the account it points at (a data wipe or
  // account deletion), and it can outlive a revocation: logout, password reset
  // or a 2FA change bumps `tokenVersion`, and any token minted before that
  // carries an older `tv`. Both cases are refused here.
  let user: { tokenVersion?: number | null } | null;
  try {
    user = await User.findById(payload.userId).select("tokenVersion").lean();
  } catch {
    // Malformed id in the token: treat as unauthenticated rather than 500.
    throw new UnauthorizedError("Invalid access token.");
  }
  if (!user) {
    throw new UnauthorizedError("Account no longer exists.");
  }
  if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
    throw new UnauthorizedError("Session has been revoked. Please sign in again.");
  }
  req.auth = payload;
  next();
}

export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) throw new UnauthorizedError();
  if (req.auth.role !== "platform_admin") {
    throw new ForbiddenError("Platform admin role required.");
  }
  next();
}

export function requireOrg(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) throw new UnauthorizedError();
  const orgId = req.auth.organizationId;
  if (!orgId) throw new ForbiddenError("No organization context in token.");
  req.orgId = orgId;
  next();
}

/**
 * Confirms, against the database, that the caller is still an ACTIVE member of
 * the org their token names. Mount after `requireOrg`.
 *
 * `requireOrg` trusts the token's `organizationId`, so a member who was removed
 * (or whose membership was revoked) keeps reading the org's data until their
 * access token expires. For routes that expose an org's analytics wholesale,
 * that window is a tenancy leak rather than a stale session, so they check.
 * One probe on the unique `(userId, organizationId)` index.
 */
export async function requireActiveMembership(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.auth || !req.orgId) throw new UnauthorizedError();
  let active: boolean;
  try {
    active = Boolean(
      await Membership.exists({
        userId: req.auth.userId,
        organizationId: req.orgId,
        status: "active",
      }),
    );
  } catch {
    // A malformed id in the token cannot name a membership.
    active = false;
  }
  if (!active) throw new ForbiddenError("Not a member of this organization.");
  next();
}

/**
 * Revokes every outstanding access and refresh token for a user by bumping the
 * `tokenVersion` that `requireAuth`, `/auth/refresh` and the socket handshake
 * compare against.
 */
export async function revokeUserTokens(userId: unknown): Promise<void> {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}
