import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { UnauthorizedError, ForbiddenError } from "../utils/errors.js";
import { User } from "../models/index.js";

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
  // The token signature can outlive the account it points at — e.g. after a data
  // wipe or account deletion the cookie/JWT is still cryptographically valid.
  // Reject it so stale sessions can't keep hitting authed endpoints (and so the
  // web app clears the cookie instead of bouncing the ghost user to /checkout).
  let exists: boolean;
  try {
    exists = Boolean(await User.exists({ _id: payload.userId }));
  } catch {
    // Malformed id in the token — treat as unauthenticated rather than 500.
    throw new UnauthorizedError("Invalid access token.");
  }
  if (!exists) {
    throw new UnauthorizedError("Account no longer exists.");
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
