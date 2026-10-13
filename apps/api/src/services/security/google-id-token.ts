// Verifies a Google Sign-In id_token against Google's published signing keys.
//
// POST /auth/google used to trust the `email` in the request body and never
// checked the token, so anyone could mint a session for any account by naming
// its address. Every identity claim now comes from a token whose signature,
// issuer, audience and expiry have been checked here.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"] as const;

export type GoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
};

type Jwk = crypto.JsonWebKey & { kid?: string };

let cache: { keys: Map<string, crypto.KeyObject>; expiresAt: number } | null = null;

async function loadKeys(force = false): Promise<Map<string, crypto.KeyObject>> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.keys;
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Google JWKS fetch failed (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = new Map<string, crypto.KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kid) keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
  }
  // Google rotates keys roughly daily and sends Cache-Control max-age. One hour
  // is well inside that, and an unknown `kid` forces an early refetch anyway.
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  cache = { keys, expiresAt: Date.now() + Math.min(maxAge, 3600) * 1000 };
  return keys;
}

/** Throws when the token is not a valid Google id_token for one of our client ids. */
export async function verifyGoogleIdToken(idToken: unknown): Promise<GoogleIdentity> {
  if (typeof idToken !== "string" || idToken.length === 0) throw new Error("Missing id_token.");
  const audiences = env.googleClientIds;
  if (audiences.length === 0) throw new Error("GOOGLE_CLIENT_ID is not configured.");

  const header = jwt.decode(idToken, { complete: true })?.header;
  const kid = header?.kid;
  if (!kid || header?.alg !== "RS256") throw new Error("Unexpected id_token header.");

  let key = (await loadKeys()).get(kid);
  if (!key) key = (await loadKeys(true)).get(kid);
  if (!key) throw new Error("Unknown id_token signing key.");

  const payload = jwt.verify(idToken, key, {
    algorithms: ["RS256"],
    issuer: [...ISSUERS],
    audience: audiences as [string, ...string[]],
  }) as jwt.JwtPayload & { email?: string; email_verified?: boolean | string; name?: string };

  if (!payload.sub || typeof payload.email !== "string") throw new Error("id_token lacks sub or email.");
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase().trim(),
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}
