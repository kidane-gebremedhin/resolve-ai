import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { verifyTotp } from "./security/totp.js";
import mongoose from "mongoose";
import { Organization, User, Membership } from "../models/index.js";
import { signAccessToken, signRefreshToken } from "../utils/jwt.js";
import { env } from "../config/env.js";
import {
  ConflictError,
  ForbiddenError,
  InvalidTotpError,
  TotpRequiredError,
  UnauthorizedError,
} from "../utils/errors.js";
import { bindReferralOnSignup } from "./affiliate.service.js";
import { openSecret } from "./security/secret-field.js";
import { verifyGoogleIdToken } from "./security/google-id-token.js";
import { sendMail } from "./mailer.service.js";
import { escapeHtml } from "../utils/html.js";
import { logger } from "../config/logger.js";

const BCRYPT_COST = 12;

// The clients refresh their access token when `expiresIn` says it is about to
// die, so this number has to be the TRUTH about JWT_ACCESS_EXPIRY — not a
// constant that happens to match the default. Hardcoding 900 meant that
// changing JWT_ACCESS_EXPIRY to anything shorter silently broke refresh: the
// API issued a short-lived token while telling the dashboard it had 15
// minutes, so the token died mid-session and the next call 401'd the operator
// straight back to the login page.
export function accessTokenSeconds(): number {
  const raw = String(env.jwtAccessExpiry).trim();
  const m = /^(\d+)\s*([smhd])?$/i.exec(raw);
  if (!m) return 900; // unparseable config — fall back to the documented default
  const n = Number(m[1]);
  switch ((m[2] ?? "s").toLowerCase()) {
    case "d": return n * 86_400;
    case "h": return n * 3_600;
    case "m": return n * 60;
    default: return n;
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
  organizationName: string;
  referralCode?: string;
  campaignCode?: string;
}) {
  // An invited person who never accepted has a placeholder user with no
  // password (see org invites). Registering claims that row instead of failing
  // with "Email already in use", which used to lock invitees out for good.
  //
  // Only a PROVABLY unclaimed placeholder qualifies: no password, never
  // verified, no 2FA, and no active membership. A password-less account can
  // also be a real, in-use account (Google sign-in clears the password of an
  // unverified account it takes over), and claiming that one here would hand
  // its data to whoever registers the address.
  const existing = await User.findOne({ email: input.email });
  const isUnclaimedPlaceholder =
    existing !== null &&
    existing.provider === "credentials" &&
    !existing.passwordHash &&
    !existing.emailVerifiedAt &&
    !existing.totpEnabled &&
    !(await Membership.exists({ userId: existing._id, status: "active" }));
  if (existing && !isUnclaimedPlaceholder) {
    throw new ConflictError("Email already in use.");
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  const baseSlug = slugify(input.organizationName) || `org-${Date.now()}`;
  let slug = baseSlug;
  let attempt = 0;
  while (await Organization.exists({ slug })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  let user;
  if (existing) {
    existing.name = input.name;
    existing.passwordHash = passwordHash;
    // Nothing should be holding a session for a placeholder, but if anything
    // is, it ends here.
    existing.tokenVersion = (existing.tokenVersion ?? 0) + 1;
    await existing.save();
    user = existing;
  } else {
    user = await User.create({
      email: input.email,
      name: input.name,
      provider: "credentials",
      passwordHash,
      role: "user",
    });
  }

  const org = await Organization.create({
    name: input.organizationName,
    slug,
    campaignCode: input.campaignCode?.toLowerCase().trim() || undefined,
  });

  await Membership.create({
    userId: user._id,
    organizationId: org._id,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });

  // Best-effort referral attribution (never blocks signup).
  await bindReferralOnSignup({
    code: input.referralCode,
    organizationId: org._id,
    referredUserId: user._id,
  });

  // Best-effort: a mail failure must not fail the signup.
  await sendEmailVerification(user).catch((err) =>
    logger.error("[auth] verification email failed", { err: (err as Error).message }),
  );

  return issueTokens(user, org._id.toString(), "owner");
}

/**
 * The membership a new session should land in: the explicitly requested org,
 * then the user's last joined/used org, then their oldest active membership.
 * Each candidate must still be active.
 */
export async function pickActiveMembership(
  user: { _id: unknown; lastOrganizationId?: unknown },
  preferredOrgId?: unknown,
) {
  for (const orgId of [preferredOrgId, user.lastOrganizationId]) {
    if (!orgId) continue;
    const m = await Membership.findOne({ userId: user._id, organizationId: orgId, status: "active" });
    if (m) return m;
  }
  return Membership.findOne({ userId: user._id, status: "active" }).sort({ createdAt: 1 });
}

/**
 * Returns the user's active membership, creating an Organization + owner
 * Membership on first call if none exists. Used by SSO sign-in (Google) so
 * that JWTs always carry an `organizationId` — without it every protected
 * route 403s with "No organization context in token." (See spec 12 §1.1.)
 */
export async function ensureMembershipForUser(user: {
  _id: mongoose.Types.ObjectId | string;
  email: string;
  name: string;
  lastOrganizationId?: unknown;
}) {
  const existing = await pickActiveMembership(user);
  if (existing) return existing;

  const baseSlug =
    slugify(user.name) ||
    slugify(user.email.split("@")[0] ?? "") ||
    `org-${Date.now()}`;
  let slug = baseSlug;
  let attempt = 0;
  while (await Organization.exists({ slug })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const org = await Organization.create({
    name: `${user.name}'s workspace`,
    slug,
  });

  return Membership.create({
    userId: user._id,
    organizationId: org._id,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
}

// Verify a 6-digit TOTP, or fall back to a one-time recovery code.
//
// Recovery codes are stored as bcrypt hashes and are CONSUMED on use: a code
// that logs you in once must never work again, otherwise a code read over
// someone's shoulder (or left in a screenshot) becomes a permanent password
// bypass. The consuming write happens before the login is allowed to succeed.
async function verifySecondFactor(
  user: {
    totpSecret?: string | null;
    recoveryCodes?: string[] | null;
    save: () => Promise<unknown>;
  },
  code: string,
): Promise<boolean> {
  const secret = openSecret(user.totpSecret);
  if (secret) {
    try {
      if (await verifyTotp(secret, code)) return true;
    } catch {
      // otplib rejects anything that isn't a well-formed 6-digit token, and a
      // recovery code ("xxxx-xxxx-xxxx") is exactly that. Swallow it so the
      // recovery path below still gets a chance — without this, entering a
      // recovery code returned a 500 instead of logging the user in.
    }
  }

  const hashes = user.recoveryCodes ?? [];
  for (let i = 0; i < hashes.length; i += 1) {
    if (await bcrypt.compare(code, hashes[i])) {
      hashes.splice(i, 1);
      user.recoveryCodes = hashes;
      await user.save();
      return true;
    }
  }
  return false;
}

/**
 * Email + password login, with the second factor enforced when the account has
 * one.
 *
 * `code` is optional so an account without 2FA still logs in on one round trip;
 * a 2FA account answers `totp_required` on the first attempt and succeeds on the
 * retry carrying the code. Enforcement lives HERE rather than in the route so
 * every caller — the dashboard's NextAuth provider, the admin console, any
 * future client — is gated by construction and cannot forget to ask.
 */
export async function loginWithCredentials(email: string, password: string, code?: string) {
  const user = await User.findOne({ email });
  if (!user || !user.passwordHash) throw new UnauthorizedError("Invalid email or password.");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new UnauthorizedError("Invalid email or password.");

  // Only after the password is proven correct — someone without it learns
  // nothing about whether the account has 2FA enabled.
  if (user.totpEnabled) {
    if (!code) throw new TotpRequiredError();
    if (!(await verifySecondFactor(user, code))) throw new InvalidTotpError();
  }

  user.lastLoginAt = new Date();
  await user.save();

  const membership = await pickActiveMembership(user);
  return issueTokens(
    user,
    membership?.organizationId?.toString(),
    membership?.role as "owner" | "admin" | "agent" | "viewer" | undefined,
  );
}

// ---- Password reset -------------------------------------------------------
// Request a reset: mint a random token, store only its SHA-256 hash + a short
// expiry, and email the user a link. Returns the RAW token to the caller (the
// route) only so tests can drive the flow; the route itself emails it, never
// returns it. Always resolves silently for unknown emails / OAuth-only accounts —
// we must NOT reveal whether an email is registered (account enumeration).
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordReset(email: string): Promise<{ token: string; user: { email: string; name: string } } | null> {
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  // Only credentials users can reset a password (Google users have no passwordHash).
  if (!user || user.provider !== "credentials") return null;
  const token = crypto.randomBytes(32).toString("hex");
  user.passwordResetTokenHash = hashResetToken(token);
  user.passwordResetExpires = new Date(Date.now() + RESET_TTL_MS);
  await user.save();
  return { token, user: { email: user.email, name: user.name } };
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (!token || typeof token !== "string") throw new UnauthorizedError("Invalid or expired reset link.");
  const user = await User.findOne({
    passwordResetTokenHash: hashResetToken(token),
    passwordResetExpires: { $gt: new Date() },
  });
  if (!user) throw new UnauthorizedError("This reset link is invalid or has expired.");
  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpires = undefined;
  // Reaching this line proves control of the inbox. If the address was never
  // verified, whoever set up the account (and any 2FA on it) may not be the
  // owner, so their second factor goes too.
  if (!user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date();
    user.totpEnabled = false;
    user.totpSecret = undefined;
    user.recoveryCodes = undefined;
  }
  // A reset is how people recover a compromised account: every session that
  // existed before it, including stolen refresh tokens, stops working.
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();
}

// ---- Email verification ---------------------------------------------------
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export async function sendEmailVerification(user: {
  _id: unknown;
  email: string;
  name: string;
}): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        emailVerifyTokenHash: hashResetToken(token),
        emailVerifyExpires: new Date(Date.now() + VERIFY_TTL_MS),
      },
    },
  );
  const link = `${env.webBaseUrl}/verify-email?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Confirm your email address",
    html:
      `<p>Hi ${escapeHtml(user.name || "there")},</p>` +
      `<p>Please confirm this is your email address. The link expires in 24 hours.</p>` +
      `<p><a href="${link}">Confirm my email</a></p>` +
      `<p>If you didn't create an account, you can ignore this email.</p>`,
  });
}

export async function verifyEmail(token: string): Promise<void> {
  const user = await User.findOne({
    emailVerifyTokenHash: hashResetToken(token),
    emailVerifyExpires: { $gt: new Date() },
  });
  if (!user) throw new UnauthorizedError("This verification link is invalid or has expired.");
  user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
  user.emailVerifyTokenHash = undefined;
  user.emailVerifyExpires = undefined;
  await user.save();
}

// ---- Google sign-in -------------------------------------------------------
/**
 * Exchanges a Google id_token for our session tokens. Identity comes ONLY from
 * the verified token; the request body's email is ignored.
 *
 * Linking to an existing account by email:
 *   - an account with 2FA must sign in with its password and code, so Google
 *     cannot be used to step around the second factor;
 *   - an account whose email was never verified may have been registered by
 *     someone else ahead of the real owner (account pre-hijacking). Google has
 *     just proven ownership, so the unverified password is cleared and every
 *     prior session revoked before the owner gets in.
 */
export async function signInWithGoogle(idToken: unknown) {
  let identity;
  try {
    identity = await verifyGoogleIdToken(idToken);
  } catch (err) {
    logger.warn("[auth] google id_token rejected", { reason: (err as Error).message });
    throw new UnauthorizedError("Google sign-in could not be verified.");
  }
  if (!identity.emailVerified) {
    throw new UnauthorizedError("Your Google account's email address is not verified.");
  }

  let user = await User.findOne({ email: identity.email });
  if (user) {
    if (user.totpEnabled) {
      throw new ForbiddenError(
        "This account uses two-factor authentication. Sign in with your email, password and code.",
      );
    }
    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      user.passwordHash = undefined;
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    }
    user.lastLoginAt = new Date();
    await user.save();
  } else {
    user = await User.create({
      email: identity.email,
      name: identity.name || identity.email.split("@")[0],
      provider: "google",
      providerId: identity.sub,
      role: "user",
      emailVerifiedAt: new Date(),
      lastLoginAt: new Date(),
    });
  }

  const membership = await ensureMembershipForUser(user);
  return issueTokens(
    user,
    membership.organizationId.toString(),
    membership.role as "owner" | "admin" | "agent" | "viewer",
  );
}

export function issueTokens(
  user: {
    _id: mongoose.Types.ObjectId | string;
    email: string;
    name: string;
    role: string;
    tokenVersion?: number | null;
  },
  organizationId: string | undefined,
  membershipRole: "owner" | "admin" | "agent" | "viewer" | undefined,
) {
  const userId = user._id.toString();
  const tv = user.tokenVersion ?? 0;
  const accessToken = signAccessToken({
    userId,
    organizationId,
    role: user.role as "user" | "platform_admin",
    membershipRole,
    tv,
  });
  const refreshToken = signRefreshToken({ userId, tv, organizationId });
  return {
    user: {
      id: userId,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId,
      membershipRole,
    },
    accessToken,
    refreshToken,
    expiresIn: accessTokenSeconds(),
  };
}
