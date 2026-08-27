import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../config/logger.js";

// Validates Twilio's `X-Twilio-Signature` header.
//
// Twilio signs each webhook with the account's auth token, which is the only
// thing that distinguishes a real Twilio request from anyone else who has
// guessed the URL — these endpoints are public by necessity, so the signature
// IS the authentication. The scheme (documented under "Validating Signatures
// from Twilio") is:
//
//   1. take the full URL Twilio requested, query string included;
//   2. for a form-encoded POST, append each parameter as `key + value`, with
//      the keys sorted lexicographically;
//   3. HMAC-SHA1 that string with the auth token and base64 the digest.
//
// Reimplemented here rather than pulling in the `twilio` SDK: this is the only
// piece of it we need, and the algorithm is fixed and short.

function expectedSignature(authToken: string, url: string, params: Record<string, unknown>): string {
  // Sorting is part of the scheme, not an optimisation — Twilio builds the same
  // string on its side and any other order produces a different digest.
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + String(params[key] ?? ""), url);
  return crypto.createHmac("sha1", authToken).update(Buffer.from(payload, "utf-8")).digest("base64");
}

// `timingSafeEqual` throws on a length mismatch, which would itself leak length
// through the exception path — compare digests of both sides so the inputs are
// always the same size.
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function validateTwilioSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Fail closed. An unconfigured deployment must not serve an unauthenticated
  // webhook that shapes call behaviour — if the bridge isn't set up, the
  // endpoint isn't available.
  if (!authToken) {
    logger.warn("[voice] /twiml called but TWILIO_AUTH_TOKEN is unset — refusing");
    res.status(503).json({
      error: { code: "voice_not_configured", message: "Voice bridge is not configured." },
    });
    return;
  }

  const signature = req.get("x-twilio-signature");
  if (!signature) {
    res.status(403).json({
      error: { code: "invalid_signature", message: "Missing Twilio signature." },
    });
    return;
  }

  // `trust proxy` is enabled, so req.protocol reflects X-Forwarded-Proto and
  // this reconstructs the https:// URL Twilio actually signed rather than the
  // http:// one that reached the app behind the load balancer.
  const url = `${req.protocol}://${req.get("host") ?? ""}${req.originalUrl}`;
  const params = (req.body ?? {}) as Record<string, unknown>;

  if (!safeEqual(signature, expectedSignature(authToken, url, params))) {
    logger.warn("[voice] rejected /twiml with a bad Twilio signature", { url });
    res.status(403).json({
      error: { code: "invalid_signature", message: "Invalid Twilio signature." },
    });
    return;
  }

  next();
}
