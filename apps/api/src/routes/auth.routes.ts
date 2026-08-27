import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { generateSecret, generateURI } from "otplib";
import { verifyTotp } from "../services/security/totp.js";
import { sealSecret, openSecret } from "../services/security/secret-field.js";
import QRCode from "qrcode";
import { validateBody } from "../middleware/validation.middleware.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  loginWithCredentials,
  registerUser,
  ensureMembershipForUser,
  requestPasswordReset,
  resetPassword,
  accessTokenSeconds,
} from "../services/auth.service.js";
import { sendMail } from "../services/mailer.service.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { logAuditFromReq } from "../services/audit.service.js";
import { verifyRefreshToken, signAccessToken, signRefreshToken } from "../utils/jwt.js";
import { User, Membership } from "../models/index.js";
import { UnauthorizedError, NotFoundError, ValidationError } from "../utils/errors.js";

const router = Router();

// Password-strength policy — the API is the source of truth. Mirrors the rules the
// signup UI shows (≥8 chars, one lower, one upper, one number, one special) so a
// client hitting the API directly can't set a weaker password than the form allows.
// `login` intentionally keeps `min(1)` (it only compares against the stored hash).
const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(200)
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/[0-9]/, "Password must contain a number.")
  .regex(/[^A-Za-z0-9]/, "Password must contain a special character.");

const registerSchema = z.object({
  email: z.string().email(),
  password: strongPassword,
  name: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(120),
  referralCode: z.string().min(1).max(64).optional(),
  campaignCode: z.string().min(1).max(64).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Second factor. Optional because accounts without 2FA never send one, and a
  // 2FA account's first attempt legitimately omits it — the API answers
  // `totp_required` and the client retries with the code. Accepts either a
  // 6-digit TOTP or a `xxxx-xxxx-xxxx` recovery code, so the length is loose.
  code: z.string().trim().min(1).max(32).optional(),
});

// Abuse throttles for unauthenticated auth endpoints (per client IP — the app
// runs behind a trusted proxy, so req.ip is the real caller). Successful logins
// don't count against the limit, so a legitimate user typing a wrong password a
// few times isn't locked out by their own eventual success.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: { code: "rate_limited", message: "Too many login attempts. Please try again later." },
  },
});

// Password-reset requests trigger an outbound email — throttle harder to prevent
// using the endpoint to bomb a victim's inbox.
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: "rate_limited", message: "Too many requests. Please try again later." },
  },
});

router.post("/register", validateBody(registerSchema), async (req: Request, res: Response) => {
  const result = await registerUser(req.body);
  res.status(201).json(result);
});

router.post("/login", loginLimiter, validateBody(loginSchema), async (req: Request, res: Response) => {
  const result = await loginWithCredentials(req.body.email, req.body.password, req.body.code);
  res.json(result);
});

// ---- Password reset -------------------------------------------------------
const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({ token: z.string().min(1), password: strongPassword });

// Always returns 200 with the same message whether or not the email exists — never
// reveal which addresses are registered (account enumeration). When it does match a
// credentials account we email a one-hour reset link.
router.post("/forgot-password", forgotLimiter, validateBody(forgotSchema), async (req: Request, res: Response) => {
  const result = await requestPasswordReset(req.body.email);
  if (result) {
    const link = `${env.webBaseUrl}/reset-password?token=${result.token}`;
    try {
      await sendMail({
        to: result.user.email,
        subject: "Reset your password",
        html:
          `<p>Hi ${result.user.name || "there"},</p>` +
          `<p>We received a request to reset your password. Click the link below to choose a new one — it expires in 1 hour.</p>` +
          `<p><a href="${link}">Reset your password</a></p>` +
          `<p>If you didn't request this, you can safely ignore this email.</p>`,
      });
    } catch (err) {
      // Don't leak send failures to the client (still return the generic message),
      // but log so the operator can see SMTP problems.
      logger.error("[auth] password reset email failed", { err: (err as Error).message });
    }
  }
  res.json({ ok: true, message: "If an account exists for that email, a reset link has been sent." });
});

router.post("/reset-password", validateBody(resetSchema), async (req: Request, res: Response) => {
  await resetPassword(req.body.token, req.body.password);
  res.json({ ok: true, message: "Your password has been reset. You can now log in." });
});

router.post("/refresh", async (req: Request, res: Response) => {
  const token = req.body?.refreshToken;
  if (!token || typeof token !== "string") throw new UnauthorizedError();
  let decoded: { userId: string };
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new UnauthorizedError("Invalid refresh token.");
  }
  const user = await User.findById(decoded.userId);
  if (!user) throw new UnauthorizedError();
  const membership = await Membership.findOne({ userId: user._id, status: "active" }).sort({
    createdAt: 1,
  });
  const accessToken = signAccessToken({
    userId: user._id.toString(),
    organizationId: membership?.organizationId?.toString(),
    role: user.role as "user" | "platform_admin",
    membershipRole: membership?.role as "owner" | "admin" | "agent" | "viewer" | undefined,
  });
  res.json({ accessToken, expiresIn: accessTokenSeconds() });
});

// Google's stable per-account id lives in the id_token's `sub` claim. We use it
// as `providerId` so the unique (provider, providerId) index identifies a Google
// account exactly once. The old `idToken.slice(0, 64)` was wrong on two counts:
// it changed every login (a fresh JWT each time), and—because every Google
// id_token shares the same JWT header + signing-key `kid` prefix—two *different*
// new users routinely collided on the first 64 chars, throwing E11000 → 500.
// We decode (not verify) the payload, matching the existing "no upstream
// verification yet" posture; signature verification is the follow-up.
function googleProviderId(idToken: unknown, email: string): string {
  if (typeof idToken === "string") {
    const payloadPart = idToken.split(".")[1];
    if (payloadPart) {
      try {
        const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
        if (typeof payload?.sub === "string" && payload.sub) return payload.sub;
      } catch {
        // Not a real JWT (e.g. a test token) — fall through to the email fallback.
      }
    }
  }
  // Fallback keeps providerId unique per email so a missing `sub` or a non-JWT
  // token can never collide on the unique index (which would 500 every signup
  // after the first).
  return `email:${email.toLowerCase()}`;
}

// Google id_token exchange: NextAuth on apps/web calls this after Google sign-in.
// In Phase 0 we accepted any id_token and didn't verify upstream — this scaffolds
// the endpoint shape; signature verification belongs to the google-auth-library
// integration which we wire in once it's actually in use.
//
// First-time Google sign-in MUST also create an Organization + owner Membership.
// Without this the issued JWT carries no `organizationId`, and every protected
// route then 403s with "No organization context in token." See spec 12.
// An EXISTING email reuses its user + organization (ensureMembershipForUser is
// keyed by userId and returns the existing membership) — we never create a
// second organization for an email that already has one.
router.post("/google", async (req: Request, res: Response) => {
  const { idToken, email, name } = req.body ?? {};
  if (typeof email !== "string" || typeof name !== "string") {
    throw new UnauthorizedError("Missing Google identity payload.");
  }
  // Upsert by email: an existing account (Google OR credentials) is reused, so a
  // returning user never gets a duplicate user record or organization.
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      email,
      name,
      provider: "google",
      providerId: googleProviderId(idToken, email),
      role: "user",
    });
  }
  const membership = await ensureMembershipForUser(user);
  const accessToken = signAccessToken({
    userId: user._id.toString(),
    organizationId: membership.organizationId.toString(),
    role: user.role as "user" | "platform_admin",
    membershipRole: membership.role as "owner" | "admin" | "agent" | "viewer",
  });
  const refreshToken = signRefreshToken({ userId: user._id.toString() });
  res.json({
    user: {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: membership.organizationId.toString(),
    },
    accessToken,
    refreshToken,
    expiresIn: accessTokenSeconds(),
  });
});

// ----------------------------------------------------------------- 2FA / TOTP
// The setup → verify → (later) disable flow is split into three calls so the
// secret + recovery codes are only shown ONCE and 2FA isn't actually flipped
// on until the user has proven they can produce a valid code from the secret.
// Login enforcement lives in auth.service.ts (`loginWithCredentials`), not
// here, so every client is gated by construction: POST /auth/login answers
// `totp_required` when the password is right but no code was sent, and
// `invalid_totp` when the code is wrong. Both the dashboard and the admin
// console surface those codes through their NextAuth credentials provider and
// reveal a code field. Recovery codes are accepted in place of a TOTP and are
// consumed on use.

const ISSUER = "CSB";
const RECOVERY_CODE_COUNT = 10;
const BCRYPT_COST = 10;

// Alphabet for recovery codes. Deliberately NOT base64url, which was the
// original choice: base64url contains `-` and `_`, and the codes are formatted
// in `-` separated groups, so it produced codes like `lc-i-guvt-wozz` and
// `a9gj-7mi3-1cb-` where the separator is indistinguishable from a character.
// These get written on paper and read back under stress, so ambiguity is the
// one thing they cannot afford.
//
// Also drops the characters people reliably confuse when transcribing:
// 0/o, 1/l/i.
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    // Rejection-free selection: 31 symbols would bias a plain %-of-256 mapping,
    // so draw a byte per character from a range that divides evenly.
    const bytes = crypto.randomBytes(12 * 2);
    let out = "";
    for (let b = 0; out.length < 12; b += 1) {
      const v = bytes[b % bytes.length];
      if (v >= 248) continue; // 248 = 31 * 8, the largest unbiased cut
      out += RECOVERY_ALPHABET[v % RECOVERY_ALPHABET.length];
    }
    codes.push(`${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`);
  }
  return codes;
}

router.post("/2fa/setup", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.auth!.userId);
  if (!user) throw new NotFoundError("User not found.");

  const secret = generateSecret();
  const uri = generateURI({
    issuer: ISSUER,
    label: user.email,
    secret,
  });
  const qrCodeDataUrl = await QRCode.toDataURL(uri);

  const recoveryCodes = generateRecoveryCodes();
  const recoveryHashes = await Promise.all(
    recoveryCodes.map((code) => bcrypt.hash(code, BCRYPT_COST)),
  );

  // Stash the secret + recovery hashes but DON'T flip totpEnabled — that
  // only happens after `/2fa/verify` succeeds, proving the user actually
  // enrolled the secret in an authenticator app.
  // Sealed at rest: a database dump alone must not yield working TOTP seeds.
  user.totpSecret = sealSecret(secret);
  user.totpEnabled = false;
  user.recoveryCodes = recoveryHashes;
  await user.save();

  res.json({ secret, qrCodeDataUrl, recoveryCodes, otpauthUrl: uri });
});

const verifySchema = z.object({ code: z.string().min(6).max(8) });

router.post(
  "/2fa/verify",
  requireAuth,
  validateBody(verifySchema),
  async (req: Request, res: Response) => {
    const user = await User.findById(req.auth!.userId);
    if (!user) throw new NotFoundError("User not found.");
    if (!user.totpSecret) {
      throw new ValidationError("Run /2fa/setup before verifying.");
    }
    const valid = await verifyTotp(openSecret(user.totpSecret)!, req.body.code);
    if (!valid) {
      // 400, deliberately NOT 401. The caller's session is perfectly valid —
      // they just mistyped a code. Returning 401 made the dashboard's global
      // "401 means the session died" handler sign the user out and bounce them
      // to /login?session=expired, losing the recovery codes still on screen.
      throw new ValidationError("Invalid 2FA code.");
    }
    user.totpEnabled = true;
    await user.save();
    await logAuditFromReq(req, "2fa.enabled", req.auth!.userId);
    res.json({ ok: true, totpEnabled: true });
  },
);

const disableSchema = z
  .object({
    password: z.string().min(1).optional(),
    code: z.string().min(6).max(8).optional(),
  })
  .refine((v) => Boolean(v.password) || Boolean(v.code), {
    message: "Either password or code is required.",
  });

router.post(
  "/2fa/disable",
  requireAuth,
  validateBody(disableSchema),
  async (req: Request, res: Response) => {
    const user = await User.findById(req.auth!.userId);
    if (!user) throw new NotFoundError("User not found.");

    // Accept either the user's password OR a currently-valid TOTP code so a
    // logged-in user who lost their authenticator can disable via password.
    let authorised = false;
    if (req.body.password && user.passwordHash) {
      authorised = await bcrypt.compare(req.body.password, user.passwordHash);
    }
    if (!authorised && req.body.code && user.totpSecret) {
      authorised = await verifyTotp(openSecret(user.totpSecret)!, req.body.code);
    }
    if (!authorised) {
      // Same reasoning as /2fa/verify: the session is valid, the supplied
      // password or code was not.
      throw new ValidationError("Could not verify identity to disable 2FA.");
    }

    user.totpEnabled = false;
    user.totpSecret = undefined;
    user.recoveryCodes = undefined;
    await user.save();
    await logAuditFromReq(req, "2fa.disabled", req.auth!.userId);
    res.json({ ok: true, totpEnabled: false });
  },
);

router.get("/2fa/status", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.auth!.userId).select("totpEnabled").lean();
  if (!user) throw new NotFoundError("User not found.");
  res.json({ totpEnabled: Boolean(user.totpEnabled) });
});

export default router;
