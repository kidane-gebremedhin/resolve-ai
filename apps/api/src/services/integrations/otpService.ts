import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { sendMail } from "../mailer.service.js";
import { ContactSession, OtpChallenge } from "../../models/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { escapeHtml } from "../../utils/html.js";

/** Wrong guesses allowed per code before it is burned. */
export const OTP_MAX_ATTEMPTS = 5;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function generateCode(): string {
  return String(Math.floor(100000 + (randomBytes(4).readUInt32BE(0) % 900000)));
}

export async function sendIdentityOtp(
  sessionToken: string,
  session: { email?: string | null } | null,
  // The operator's brand (e.g. their organization name), so the customer sees a code
  // email that reads as coming from the business they're actually talking to rather
  // than the bare platform sender. Optional — falls back to a generic message.
  brandName?: string,
): Promise<string> {
  const email = session?.email?.toLowerCase().trim();
  if (!email) {
    throw new Error("Cannot send OTP: no email on contact session.");
  }
  const sessionTokenHash = sha256(sessionToken);

  // Reuse an outstanding code for this session AND address instead of minting a
  // new one per send. A retried tool call (or the model calling twice) used to
  // email a second code while the widget's card carried the newer token.
  const outstanding = await OtpChallenge.findOne({
    sessionTokenHash,
    email,
    expiresAt: { $gt: new Date() },
    attempts: { $lt: OTP_MAX_ATTEMPTS },
  }).lean();
  if (outstanding) {
    logger.info("[otp] reusing outstanding code", { handle: outstanding.handle });
    return outstanding.handle;
  }

  const code = generateCode();
  const handle = randomBytes(16).toString("hex");
  await OtpChallenge.create({
    handle,
    sessionTokenHash,
    codeHash: sha256(`${handle}:${code}`),
    email,
    expiresAt: new Date(Date.now() + env.otpExpirySeconds * 1000),
  });

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

  logger.info("[otp] sent", { handle });
  return handle;
}

/**
 * Checks a code. Each call spends one of `OTP_MAX_ATTEMPTS` attempts BEFORE
 * comparing (atomically, so parallel guesses cannot share an attempt), and a
 * code that runs out is deleted. A correct code marks the session verified for
 * the email the code was sent to, provided the session still has that email.
 */
export async function verifyOtp(
  sessionToken: string,
  otpToken: string,
  code: string,
): Promise<boolean> {
  const challenge = await OtpChallenge.findOneAndUpdate(
    {
      handle: otpToken,
      sessionTokenHash: sha256(sessionToken),
      expiresAt: { $gt: new Date() },
      attempts: { $lt: OTP_MAX_ATTEMPTS },
    },
    { $inc: { attempts: 1 } },
    { new: true },
  ).lean();
  if (!challenge) return false;

  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(sha256(`${otpToken}:${String(code).trim()}`), "hex");
  if (!timingSafeEqual(expected, actual)) {
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) await OtpChallenge.deleteOne({ _id: challenge._id });
    return false;
  }

  await OtpChallenge.deleteOne({ _id: challenge._id });
  const verifiedUntil = new Date(Date.now() + 15 * 60 * 1000);
  const updated = await ContactSession.updateOne(
    { token: sessionToken, email: challenge.email },
    { $set: { identityVerifiedUntil: verifiedUntil, identityVerifiedEmail: challenge.email } },
  );
  return updated.matchedCount === 1;
}
