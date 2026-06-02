import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export type AccessTokenPayload = {
  userId: string;
  organizationId?: string;
  role: "user" | "platform_admin";
  membershipRole?: "owner" | "admin" | "agent" | "viewer";
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtAccessExpiry as SignOptions["expiresIn"],
  });
}

export function signRefreshToken(payload: { userId: string }): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtRefreshExpiry as SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { userId: string } {
  return jwt.verify(token, env.jwtSecret) as { userId: string };
}
