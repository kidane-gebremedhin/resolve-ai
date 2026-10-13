import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export type AccessTokenPayload = {
  userId: string;
  organizationId?: string;
  role: "user" | "platform_admin";
  membershipRole?: "owner" | "admin" | "agent" | "viewer";
  /** The user's `tokenVersion` at issue time. Bumping it revokes every token. */
  tv?: number;
};

export type RefreshTokenPayload = {
  userId: string;
  tv?: number;
  /** Org the session was signed into, so a refresh keeps the user there. */
  organizationId?: string;
};

// Both token kinds share JWT_SECRET, so without a type claim either one passes
// the other's verifier: a 15-minute access token could be refreshed forever,
// and a 7-day refresh token worked as a Bearer token. `typ` pins each token to
// the one place it is meant for.
type Typed = { typ?: "access" | "refresh" };

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign({ ...payload, typ: "access" }, env.jwtSecret, {
    algorithm: "HS256",
    expiresIn: env.jwtAccessExpiry as SignOptions["expiresIn"],
  });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign({ ...payload, typ: "refresh" }, env.jwtSecret, {
    algorithm: "HS256",
    expiresIn: env.jwtRefreshExpiry as SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] }) as AccessTokenPayload & Typed;
  if (decoded.typ !== "access") throw new Error("Not an access token.");
  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] }) as RefreshTokenPayload & Typed;
  if (decoded.typ !== "refresh") throw new Error("Not a refresh token.");
  return decoded;
}
