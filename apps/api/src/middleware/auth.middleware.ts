import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { UnauthorizedError, ForbiddenError } from "../utils/errors.js";

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header.");
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    req.auth = payload;
    next();
  } catch {
    throw new UnauthorizedError("Invalid or expired access token.");
  }
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
