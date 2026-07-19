import { Router, type Request, type Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { generateSecret, generateURI, verify as verifyOtp } from "otplib";
import QRCode from "qrcode";
import { validateBody } from "../middleware/validation.middleware.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  loginWithCredentials,
  registerUser,
  ensureMembershipForUser,
  requestPasswordReset,
  resetPassword,
} from "../services/auth.service.js";
import { sendMail } from "../services/mailer.service.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { logAuditFromReq } from "../services/audit.service.js";
import { verifyRefreshToken, signAccessToken, signRefreshToken } from "../utils/jwt.js";
import { User, Membership } from "../models/index.js";
import { UnauthorizedError, NotFoundError, ValidationError } from "../utils/errors.js";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(120),
  referralCode: z.string().min(1).max(64).optional(),
  campaignCode: z.string().min(1).max(64).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/register", validateBody(registerSchema), async (req: Request, res: Response) => {
  const result = await registerUser(req.body);
  res.status(201).json(result);
});

router.post("/login", validateBody(loginSchema), async (req: Request, res: Response) => {
  const result = await loginWithCredentials(req.body.email, req.body.password);
  res.json(result);
});

// ---- Password reset -------------------------------------------------------
const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({ token: z.string().min(1), password: z.string().min(8).max(200) });

// Always returns 200 with the same message whether or not the email exists — never
// reveal which addresses are registered (account enumeration). When it does match a
// credentials account we email a one-hour reset link.
router.post("/forgot-password", validateBody(forgotSchema), async (req: Request, res: Response) => {
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
  res.json({ accessToken, expiresIn: 900 });
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
    expiresIn: 900,
  });
});

// ----------------------------------------------------------------- 2FA / TOTP
// The setup → verify → (later) disable flow is split into three calls so the
// secret + recovery codes are only shown ONCE and 2FA isn't actually flipped
// on until the user has proven they can produce a valid code from the secret.
// Login enforcement is intentionally NOT wired here — that's a follow-up
// (we'd need to plumb a `requires2fa` step through the auth.service login
// path and the NextAuth credentials flow). See report TODO.

const ISSUER = "CSB";
const RECOVERY_CODE_COUNT = 10;
const BCRYPT_COST = 10;

function generateRecoveryCodes(): string[] {
  // 10 codes formatted `xxxx-xxxx-xxxx` from url-safe random bytes. Plenty of
  // entropy and easy to read aloud / copy by hand.
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    const raw = crypto.randomBytes(9).toString("base64url").slice(0, 12).toLowerCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
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
  user.totpSecret = secret;
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
    const result = await verifyOtp({
      secret: user.totpSecret,
      token: req.body.code,
    });
    if (!result.valid) {
      throw new UnauthorizedError("Invalid 2FA code.");
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
      const result = await verifyOtp({ secret: user.totpSecret, token: req.body.code });
      authorised = result.valid;
    }
    if (!authorised) {
      throw new UnauthorizedError("Could not verify identity to disable 2FA.");
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
