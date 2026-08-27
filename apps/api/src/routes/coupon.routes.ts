// Lifetime-deal coupon redemption (user-facing).
//
// Both routes are authenticated AND require org admin/owner: a coupon upgrades
// the whole workspace's plan, which is a billing action — the same bar every
// other route in billing.routes sits behind. Agents and viewers can't change
// what the org pays for.

import { Router, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { User } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { requireOrgRole } from "../middleware/org-role.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { logAuditFromReq } from "../services/audit.service.js";
import {
  failureMessage,
  redeemCoupon,
  toPublicCoupon,
  validateCoupon,
} from "../services/coupon.service.js";

const router = Router();

// A coupon code is a shared secret over a small alphabet — without a throttle
// these endpoints are a brute-force oracle against the whole code space. Keyed
// on the authenticated user when present (so one account can't rotate IPs) and
// falling back to IP for anything that slips through before requireAuth.
function couponLimiter(max: number, windowMs: number) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // ipKeyGenerator normalises IPv6 to its /64 prefix. Keying on the raw
    // req.ip would let anyone with an IPv6 allocation rotate addresses inside
    // their own subnet and walk the code space unthrottled — which is exactly
    // the brute-force oracle this limiter exists to close. express-rate-limit
    // v8 also refuses raw-IP key generators outright (ERR_ERL_KEY_GEN_IPV6),
    // so the previous version threw a ValidationError on every boot.
    keyGenerator: (req: Request) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? "unknown"),
    message: {
      error: {
        code: "rate_limited",
        message: "Too many coupon attempts. Please try again later.",
      },
    },
  });
}

// Validation is a cheap dry run, so it gets the looser budget; redemption is the
// one that actually grants something.
const validateLimiter = couponLimiter(20, 15 * 60 * 1000);
const redeemLimiter = couponLimiter(10, 60 * 60 * 1000);

// Same shape for both routes. Length bounds keep absurd payloads out of the
// index lookup; casing is normalised in the service.
const codeSchema = z.object({
  code: z.string().trim().min(3).max(64),
});

router.use(requireAuth, requireOrg, requireOrgRole("admin"));

// ---------- POST /coupons/validate ----------
// Dry run for the UI preview. Changes nothing. Never returns internalNotes,
// maxRedemptions, redemptionsCount or createdBy.
router.post(
  "/validate",
  validateLimiter,
  validateBody(codeSchema),
  async (req: Request, res: Response) => {
    const result = await validateCoupon({
      code: req.body.code,
      userId: req.auth!.userId,
      organizationId: req.orgId!,
    });

    if (!result.ok) {
      res.json({
        valid: false,
        error: failureMessage(result.failure, result.currentPlan ?? undefined),
      });
      return;
    }

    res.json({ valid: true, coupon: toPublicCoupon(result.coupon) });
  },
);

// ---------- POST /coupons/redeem ----------
// Performs the atomic claim in coupon.service. 400 on any business-rule failure.
router.post(
  "/redeem",
  redeemLimiter,
  validateBody(codeSchema),
  async (req: Request, res: Response) => {
    const user = await User.findById(req.auth!.userId).select("email").lean();

    const result = await redeemCoupon({
      code: req.body.code,
      userId: req.auth!.userId,
      userEmail: user?.email ?? "",
      organizationId: req.orgId!,
      // Abuse forensics. `trust proxy` is configured on the app, so req.ip is
      // the real caller rather than the load balancer.
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });

    if (!result.ok) {
      res.status(400).json({
        success: false,
        message: failureMessage(result.failure, result.currentPlan ?? undefined),
      });
      return;
    }

    await logAuditFromReq(req, "coupon.redeemed", result.couponCode, {
      tierGranted: result.tierGranted,
    });

    res.json({
      success: true,
      tierGranted: result.tierGranted,
      message: `Your workspace is now on the ${result.tierGranted} plan.`,
    });
  },
);

export default router;
