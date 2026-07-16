import { randomBytes, createHash } from "node:crypto";
import { sendMail } from "../mailer.service.js";
import { ContactSession } from "../../models/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

// In-memory OTP store: hash → { code, sessionToken, expiresAt }
// In production with multiple API instances use Redis (env.redisUrl).
// This implementation works for single-instance or with Redis disabled.
const otpStore = new Map<string, { code: string; sessionToken: string; expiresAt: Date }>();

// Prune expired entries periodically
setInterval(() => {
  const now = new Date();
  for (const [k, v] of otpStore) {
    if (v.expiresAt < now) otpStore.delete(k);
  }
}, 60_000);

function generateCode(): string {
  return String(Math.floor(100000 + (randomBytes(4).readUInt32BE(0) % 900000)));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendIdentityOtp(
  sessionToken: string,
  session: { email?: string | null } | null,
  // The operator's brand (e.g. their organization name), so the customer sees a code
  // email that reads as coming from the business they're actually talking to rather
  // than the bare platform sender. Optional — falls back to a generic message.
  brandName?: string,
): Promise<string> {
  const email = session?.email;
  if (!email) {
    throw new Error("Cannot send OTP: no email on contact session.");
  }

  // Reuse an outstanding, un-expired code for this session instead of minting a new one
  // per send. Without this, a retried tool call (or the model calling twice) emailed a
  // SECOND code while the widget's card carried the newer token — entering the code from
  // the older email then failed as "invalid", even though the customer did nothing wrong.
  const now = new Date();
  for (const [existingHash, entry] of otpStore) {
    if (entry.sessionToken === sessionToken && entry.expiresAt > now) {
      logger.info("[otp] reusing outstanding code", { to: email, hash: existingHash });
      return existingHash;
    }
  }

  const code = generateCode();
  const hash = createHash("sha256").update(`${sessionToken}:${code}`).digest("hex").slice(0, 16);
  const expiresAt = new Date(Date.now() + env.otpExpirySeconds * 1000);

  otpStore.set(hash, { code, sessionToken, expiresAt });

  const brand = brandName?.trim();
  const minutes = Math.round(env.otpExpirySeconds / 60);
  await sendMail({
    to: email,
    fromName: brand || undefined,
    subject: brand ? `Your ${brand} verification code` : "Your verification code",
    html: `${brand ? `<p>You're verifying your identity with <strong>${escapeHtml(brand)}</strong>.</p>` : ""}
           <p>Your one-time verification code is: <strong>${code}</strong></p>
           <p>It expires in ${minutes} minute${minutes === 1 ? "" : "s"}. If you didn't request this, you can ignore this email.</p>`,
  });

  logger.info("[otp] sent", { to: email, hash });
  return hash;
}

export async function verifyOtp(
  sessionToken: string,
  otpToken: string,
  code: string,
): Promise<boolean> {
  const entry = otpStore.get(otpToken);
  if (!entry || entry.sessionToken !== sessionToken) return false;
  if (entry.expiresAt < new Date()) {
    otpStore.delete(otpToken);
    return false;
  }
  if (entry.code !== code) return false;

  // Invalidate after first use
  otpStore.delete(otpToken);

  // Set identityVerifiedUntil on session (15 min window)
  const verifiedUntil = new Date(Date.now() + 15 * 60 * 1000);
  await ContactSession.updateOne(
    { token: sessionToken },
    { $set: { identityVerifiedUntil: verifiedUntil } },
  );

  return true;
}
