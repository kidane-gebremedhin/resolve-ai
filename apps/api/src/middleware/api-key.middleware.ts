import type { NextFunction, Request, Response } from "express";
import { verifyApiKey } from "../services/api-key.service.js";
import { UnauthorizedError } from "../utils/errors.js";

// Alternative auth path for server-to-server / SDK callers. Reads the
// `X-API-Key` header, verifies it through the service, and synthesises a
// `req.auth` shape that downstream handlers / `requireOrg` can treat the
// same as a Bearer-token session. We mark the synthetic principal with
// `userId: "apikey"` so audit rows can distinguish UI clicks from
// programmatic calls.
export async function requireApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("x-api-key") ?? req.header("X-API-Key");
  if (!header || typeof header !== "string") {
    throw new UnauthorizedError("Missing X-API-Key header.");
  }
  const verified = await verifyApiKey(header.trim());
  if (!verified) {
    throw new UnauthorizedError("Invalid, revoked, or expired API key.");
  }
  req.auth = {
    userId: "apikey",
    role: "user",
    organizationId: verified.organizationId,
    membershipRole: "agent",
  };
  req.orgId = verified.organizationId;
  next();
}
