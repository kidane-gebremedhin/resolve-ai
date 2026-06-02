// Widget session auth: validates the contact session token issued by `POST /widget/init`.
// Populates `req.contactSessionId`, `req.orgId`, `req.websiteId`. Refreshes session TTL
// on every successful request (sliding window).
import type { NextFunction, Request, Response } from "express";
import { ContactSession } from "../models/index.js";
import { UnauthorizedError } from "../utils/errors.js";
import { env } from "../config/env.js";

function extractToken(req: Request): string | null {
  const headerToken = req.headers["x-session-token"];
  if (typeof headerToken === "string" && headerToken.length > 0) return headerToken;
  if (Array.isArray(headerToken) && headerToken[0]) return headerToken[0];

  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  return null;
}

export function requireWidgetSession(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractToken(req);
  if (!token) {
    next(new UnauthorizedError("Missing widget session token."));
    return;
  }

  ContactSession.findOne({ token })
    .then(async (session) => {
      if (!session) throw new UnauthorizedError("Invalid widget session token.");
      const now = new Date();
      if (session.expiresAt && session.expiresAt.getTime() < now.getTime()) {
        throw new UnauthorizedError("Widget session has expired.");
      }

      // Sliding-window refresh.
      const ttlMs = env.sessionTokenExpiryHours * 60 * 60 * 1000;
      session.expiresAt = new Date(now.getTime() + ttlMs);
      session.lastActiveAt = now;
      // Backfill the visitor IP / user-agent if the session was created without
      // them (older sessions, or a request that reached init without a proxy
      // header). `trust proxy` makes req.ip the real client address.
      if (!session.ipAddress && req.ip) session.ipAddress = req.ip;
      if (!session.userAgent && typeof req.headers["user-agent"] === "string") {
        session.userAgent = req.headers["user-agent"];
      }
      await session.save();

      req.contactSessionId = session._id.toString();
      req.orgId = session.organizationId.toString();
      req.websiteId = session.websiteId.toString();
      next();
    })
    .catch((err) => {
      if (err instanceof UnauthorizedError) next(err);
      else next(new UnauthorizedError("Failed to authenticate widget session."));
    });
}
