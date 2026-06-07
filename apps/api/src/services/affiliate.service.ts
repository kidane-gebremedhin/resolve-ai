// Affiliate / referral logic: code generation, signup attribution, and the
// commission lifecycle (pending → earned) triggered when a referred org
// subscribes to a paid plan.

import crypto from "node:crypto";
import mongoose from "mongoose";
import { Organization, PlatformSetting, Referral, User } from "../models/index.js";
import { loadPlanCatalog } from "../config/plans.js";
import { sendMail } from "./mailer.service.js";
import { logger } from "../config/logger.js";

type Id = mongoose.Types.ObjectId | string;

function generateCode(): string {
  return crypto.randomBytes(5).toString("hex"); // 10 hex chars
}

// Idempotently assign a referral code to a user; returns the (existing or new) code.
export async function ensureReferralCode(userId: Id): Promise<string> {
  const user = await User.findById(userId).select("referralCode");
  if (!user) throw new Error("user not found");
  if (user.referralCode) return user.referralCode;
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    try {
      user.referralCode = code;
      await user.save();
      return code;
    } catch {
      // unique collision — retry with a fresh code
    }
  }
  throw new Error("could not generate a unique referral code");
}

// Bind a new signup to its referrer (if a valid, non-self code was supplied) and
// open a pending Referral. Best-effort — never blocks signup.
export async function bindReferralOnSignup(args: {
  code?: string | null;
  organizationId: Id;
  referredUserId: Id;
}): Promise<void> {
  if (!args.code) return;
  try {
    const referrer = await User.findOne({ referralCode: args.code }).select("_id");
    if (!referrer) return;
    if (referrer._id.toString() === args.referredUserId.toString()) return; // no self-referral

    await Organization.updateOne(
      { _id: args.organizationId },
      { $set: { referredByUserId: referrer._id } },
    );
    await Referral.create({
      referrerUserId: referrer._id,
      referredOrganizationId: args.organizationId,
      referredUserId: args.referredUserId,
      status: "pending",
    });
  } catch (err) {
    // unique index on referredOrganizationId, or any transient error — non-fatal
    logger.warn("[affiliate] bindReferralOnSignup failed (non-fatal)", {
      err: (err as Error).message,
    });
  }
}

// Called from the Paddle webhook when a referred org's subscription activates.
// Flips its pending referral to earned, computes the commission, and emails the
// referrer. No-op when there's no pending referral or the program is disabled.
export async function recordEarnedCommissionForOrg(
  organizationId: Id,
  plan: string,
  subscriptionId?: Id,
): Promise<void> {
  try {
    const referral = await Referral.findOne({
      referredOrganizationId: organizationId,
      status: "pending",
    });
    if (!referral) return;

    const settings = await PlatformSetting.findOne({ singleton: "global" })
      .select("affiliate")
      .lean();
    if (settings?.affiliate?.enabled === false) return;
    const ratePercent = settings?.affiliate?.ratePercent ?? 20;

    const priceUsd = (await loadPlanCatalog()).find((p) => p.plan === plan)?.priceMonthlyUsd ?? 0;
    const commissionCents = Math.round(priceUsd * 100 * (ratePercent / 100));

    referral.status = "earned";
    referral.plan = plan;
    referral.commissionRate = ratePercent;
    referral.commissionCents = commissionCents;
    referral.earnedAt = new Date();
    if (subscriptionId) referral.subscriptionId = new mongoose.Types.ObjectId(subscriptionId.toString());
    await referral.save();

    const referrer = await User.findById(referral.referrerUserId).select("email name");
    if (referrer?.email && commissionCents > 0) {
      await sendMail({
        to: referrer.email,
        subject: "You earned a referral commission 🎉",
        html: `<p>Hi ${referrer.name ?? "there"},</p>
<p>A team you referred just upgraded to the <strong>${plan}</strong> plan. You earned
<strong>$${(commissionCents / 100).toFixed(2)}</strong> (${ratePercent}% commission).</p>
<p>View your referrals in your dashboard.</p>`,
      });
    }
    logger.info("[affiliate] commission earned", {
      organizationId: organizationId.toString(),
      commissionCents,
    });
  } catch (err) {
    logger.error("[affiliate] recordEarnedCommissionForOrg failed", {
      err: (err as Error).message,
    });
  }
}
