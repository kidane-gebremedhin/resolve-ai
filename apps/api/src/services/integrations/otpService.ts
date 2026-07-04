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

export async function sendIdentityOtp(
  sessionToken: string,
  session: { email?: string | null } | null,
): Promise<string> {
  const email = session?.email;
  if (!email) {
    throw new Error("Cannot send OTP: no email on contact session.");
  }

  const code = generateCode();
  const hash = createHash("sha256").update(`${sessionToken}:${code}`).digest("hex").slice(0, 16);
  const expiresAt = new Date(Date.now() + env.otpExpirySeconds * 1000);

  otpStore.set(hash, { code, sessionToken, expiresAt });

  await sendMail({
    to: email,
    subject: "Your verification code",
    html: `<p>Your one-time verification code is: <strong>${code}</strong></p>
           <p>It expires in ${Math.round(env.otpExpirySeconds / 60)} minutes.</p>`,
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
