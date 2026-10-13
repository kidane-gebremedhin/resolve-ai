import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { MongoRateStore } from "../middleware/rate-limit-store.js";
import { z } from "zod";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { generateSecret, generateURI } from "otplib";
import { verifyTotp } from "../services/security/totp.js";
import { sealSecret, openSecret } from "../services/security/secret-field.js";
import QRCode from "qrcode";
import { validateBody } from "../middleware/validation.middleware.js";
import { requireAuth, revokeUserTokens } from "../middleware/auth.middleware.js";
import { escapeHtml } from "../utils/html.js";
import { strongPassword } from "../utils/password.js";
import {
  loginWithCredentials,
  registerUser,
  requestPasswordReset,
  resetPassword,
  accessTokenSeconds,
  signInWithGoogle,
  pickActiveMembership,
  sendEmailVerification,
  verifyEmail,
} from "../services/auth.service.js";
import { sendMail } from "../services/mailer.service.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { logAuditFromReq } from "../services/audit.service.js";
import { verifyRefreshToken, signAccessToken } from "../utils/jwt.js";
import { User, Membership } from "../models/index.js";
import { UnauthorizedError, NotFoundError, ValidationError, ConflictError } from "../utils/errors.js";

const router = Router();


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
  store: new MongoRateStore("auth:login"),
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
  store: new MongoRateStore("auth:forgot"),
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: "rate_limited", message: "Too many requests. Please try again later." },
  },
});

// Signup creates an organization and sends an email, so it is throttled like
// the other unauthenticated write endpoints.
const registerLimiter = rateLimit({
  store: new MongoRateStore("auth:register"),
  windowMs: 60 * 60 * 1000,
  max: env.registerRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: "rate_limited", message: "Too many sign-up attempts. Please try again later." },
  },
});

router.post("/register", registerLimiter, validateBody(registerSchema), async (req: Request, res: Response) => {
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
          `<p>Hi ${escapeHtml(result.user.name || "there")},</p>` +
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
  let decoded: ReturnType<typeof verifyRefreshToken>;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new UnauthorizedError("Invalid refresh token.");
  }
  let user;
  try {
    user = await User.findById(decoded.userId);
  } catch {
    throw new UnauthorizedError("Invalid refresh token.");
  }
  if (!user) throw new UnauthorizedError();
  if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
    throw new UnauthorizedError("Session has been revoked. Please sign in again.");
  }
  // Stay in the org the session was signed into while that membership is
  // still active; otherwise fall back (see pickActiveMembership).
  const membership = await pickActiveMembership(user, decoded.organizationId);
  const accessToken = signAccessToken({
    userId: user._id.toString(),
    organizationId: membership?.organizationId?.toString(),
    role: user.role as "user" | "platform_admin",
    membershipRole: membership?.role as "owner" | "admin" | "agent" | "viewer" | undefined,
    tv: user.tokenVersion ?? 0,
  });
  res.json({ accessToken, expiresIn: accessTokenSeconds() });
});

// Signs the user out everywhere: every access and refresh token issued so far
// stops working, on every device.
router.post("/logout", requireAuth, async (req: Request, res: Response) => {
  await revokeUserTokens(req.auth!.userId);
  await logAuditFromReq(req, "auth.logout", req.auth!.userId);
  res.json({ ok: true });
});

// ---- Email verification ----------------------------------------------------
const verifyEmailSchema = z.object({ token: z.string().min(1).max(200) });

router.post("/verify-email", validateBody(verifyEmailSchema), async (req: Request, res: Response) => {
  await verifyEmail(req.body.token);
  res.json({ ok: true, message: "Your email address is confirmed." });
});

router.post("/verify-email/resend", requireAuth, forgotLimiter, async (req: Request, res: Response) => {
  const user = await User.findById(req.auth!.userId);
  if (!user) throw new NotFoundError("User not found.");
  if (user.emailVerifiedAt) throw new ConflictError("Your email address is already confirmed.");
  await sendEmailVerification(user);
  res.json({ ok: true });
});

// Google sign-in: NextAuth on apps/web and apps/admin calls this after Google
// returns. The id_token is verified against Google's keys and is the ONLY
// source of identity; see `signInWithGoogle` for the account-linking rules.
const googleLimiter = rateLimit({
  store: new MongoRateStore("auth:google"),
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many sign-in attempts. Please try again later." } },
});

router.post("/google", googleLimiter, async (req: Request, res: Response) => {
  res.json(await signInWithGoogle(req.body?.idToken));
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
  // Re-running setup replaces the secret and flips 2FA off until verified. On
  // an account that already has 2FA that is a password-free way to remove it,
  // so it must go through /2fa/disable (password or code) first.
  if (user.totpEnabled) {
    throw new ConflictError("Two-factor authentication is already on. Disable it first to set it up again.");
  }

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
