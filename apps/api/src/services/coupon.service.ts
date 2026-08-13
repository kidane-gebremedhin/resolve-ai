// Lifetime-deal coupon validation, redemption and code generation.
//
// A coupon upgrades an ORGANISATION directly — it is not a checkout discount and
// never calls Paddle. Entitlement in this codebase lives on Organization.plan,
// mirrored from a Subscription row, so a grant writes both (see grantPlan()).

import crypto from "node:crypto";
import mongoose from "mongoose";
import { Coupon, CouponRedemption, Organization, Subscription } from "../models/index.js";
import type { CouponDocType } from "../models/index.js";
import { planRank, type Plan } from "../config/plans.js";
import { logger } from "../config/logger.js";

// ---------------------------------------------------------------- code gen

// Deliberately excludes I, O, 0 and 1 so codes survive being read aloud on a
// support call or retyped from a fulfilment email.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Cryptographically secure pick from ALPHABET — never Math.random(). */
function randomBlock(length: number): string {
  // Rejection-sample so the modulo doesn't bias towards the first characters of
  // the alphabet (256 % 32 === 0 here, so no bias in practice, but the guard
  // keeps this correct if ALPHABET ever changes length).
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = "";
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte >= max) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * `PARTNER-XXXX-XXXX` when a partner is given, else `XXXX-XXXX-XXXX`.
 * The partner segment is uppercased and stripped of anything outside the
 * alphabet so the result stays readable and unambiguous.
 */
export function generateCouponCode(partner?: string): string {
  const prefix = partner
    ? partner.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)
    : "";
  return prefix
    ? `${prefix}-${randomBlock(4)}-${randomBlock(4)}`
    : `${randomBlock(4)}-${randomBlock(4)}-${randomBlock(4)}`;
}

// ------------------------------------------------------------- validation

/** Distinct, user-facing reasons. Order matches the documented rule order. */
export type CouponFailure =
  | "not_found"
  | "inactive"
  | "not_yet_valid"
  | "expired"
  | "sold_out"
  | "already_used"
  | "already_entitled";

export const COUPON_FAILURE_MESSAGE: Record<CouponFailure, string> = {
  not_found: "Invalid coupon code",
  inactive: "This coupon is no longer active",
  not_yet_valid: "This coupon is not yet valid",
  expired: "This coupon has expired",
  sold_out: "This coupon has reached its maximum number of uses",
  already_used: "You have already used this coupon",
  already_entitled: "You already have a {tier} plan",
};

/**
 * When true, "code doesn't exist" and "code exists but is switched off" return
 * the SAME message, so the endpoint can't be used to enumerate which codes are
 * real. Off by default because it makes support harder; flip via env per
 * campaign. Rate limiting is the primary defence either way.
 */
const MASK_UNKNOWN_CODES = process.env.COUPON_MASK_UNKNOWN_CODES === "true";

export function failureMessage(failure: CouponFailure, tier?: string): string {
  if (MASK_UNKNOWN_CODES && (failure === "not_found" || failure === "inactive")) {
    return COUPON_FAILURE_MESSAGE.not_found;
  }
  return COUPON_FAILURE_MESSAGE[failure].replace("{tier}", tier ?? "paid");
}

/** The only coupon shape a non-admin may ever see. */
export type PublicCoupon = {
  code: string;
  grantsTier: Plan;
  description: string | null;
  partner: string | null;
};

/**
 * Whitelist — never spread the document. `internalNotes`, `maxRedemptions`,
 * `redemptionsCount` and `createdBy` must not leak to non-admins.
 */
export function toPublicCoupon(coupon: CouponDocType): PublicCoupon {
  return {
    code: coupon.code,
    grantsTier: coupon.grantsTier as Plan,
    description: coupon.description ?? null,
    partner: coupon.partner ?? null,
  };
}

type HydratedCoupon = mongoose.HydratedDocument<CouponDocType>;

export type ValidationResult =
  | { ok: true; coupon: HydratedCoupon }
  | { ok: false; failure: CouponFailure; currentPlan?: string | null };

/**
 * Dry-run check of every business rule, in order. Mutates nothing.
 *
 * NOTE: passing this is necessary but NOT sufficient to redeem — capacity and
 * per-org uniqueness are re-checked atomically at redemption time, because both
 * can change between this call and the write.
 */
export async function validateCoupon(input: {
  code: string;
  userId: string;
  organizationId: string;
  now?: Date;
}): Promise<ValidationResult> {
  const now = input.now ?? new Date();
  const code = input.code.trim().toUpperCase();

  // 1. exists
  const coupon = await Coupon.findOne({ code });
  if (!coupon) return { ok: false, failure: "not_found" };

  // 2. kill switch
  if (!coupon.isActive) return { ok: false, failure: "inactive" };

  // 3/4. validity window
  if (coupon.validFrom && coupon.validFrom > now) return { ok: false, failure: "not_yet_valid" };
  if (coupon.validUntil && coupon.validUntil < now) return { ok: false, failure: "expired" };

  // 5. global capacity
  if (coupon.redemptionsCount >= coupon.maxRedemptions) return { ok: false, failure: "sold_out" };

  // 6. per-user cap
  const usedByUser = await CouponRedemption.countDocuments({
    userId: input.userId,
    couponId: coupon._id,
  });
  if (usedByUser >= coupon.maxPerUser) return { ok: false, failure: "already_used" };

  // 6b. per-ORG cap. The grant lands on the organisation, so a workspace that
  // already redeemed this coupon must not burn a second slot even if a different
  // admin is asking.
  const usedByOrg = await CouponRedemption.countDocuments({
    organizationId: input.organizationId,
    couponId: coupon._id,
  });
  if (usedByOrg > 0) return { ok: false, failure: "already_used" };

  // 7. never downgrade — ranked comparison, not chained ifs.
  const currentPlan = await currentPlanFor(input.organizationId);
  if (planRank(currentPlan) >= planRank(coupon.grantsTier)) {
    return { ok: false, failure: "already_entitled", currentPlan };
  }

  return { ok: true, coupon };
}

/**
 * The organisation's effective plan. Mirrors planFor() in plan-limit.middleware:
 * Organization.plan is the fast path, with an entitled Subscription as fallback
 * for the window before a webhook has mirrored it.
 */
export async function currentPlanFor(organizationId: string): Promise<string | null> {
  const org = await Organization.findById(organizationId).select("plan").lean();
  if (org?.plan) return org.plan as string;
  const sub = await Subscription.findOne({ organizationId }).select("plan status").lean();
  if (sub && (sub.status === "active" || sub.status === "trialing") && sub.plan) {
    return sub.plan as string;
  }
  return null;
}

// -------------------------------------------------------------- redemption

// A lifetime grant has no renewal. We still write a period end because the
// Subscription schema requires one and the billing UI renders it; a century out
// reads unambiguously as "does not expire" without risking Date overflow.
function lifetimePeriodEnd(from: Date): Date {
  const end = new Date(from);
  end.setFullYear(end.getFullYear() + 100);
  return end;
}

/**
 * Write the entitlement: a coupon-sourced Subscription plus the Organization.plan
 * mirror that the quota middleware reads on the hot path.
 */
async function grantPlan(
  organizationId: string,
  plan: Plan,
  coupon: { _id: mongoose.Types.ObjectId; code: string },
): Promise<void> {
  const now = new Date();
  await Subscription.findOneAndUpdate(
    { organizationId },
    {
      $set: {
        plan,
        status: "active",
        source: "coupon",
        couponId: coupon._id,
        couponCode: coupon.code,
        currentPeriodStart: now,
        currentPeriodEnd: lifetimePeriodEnd(now),
        billingInterval: "month",
      },
      // Clear any Paddle provenance and cancellation state left by a previous
      // (expired or cancelled) paid subscription — the coupon supersedes it.
      $unset: {
        canceledAt: 1,
        cancelScheduledAt: 1,
        trialEndAt: 1,
        paddleSubscriptionId: 1,
        paddleCustomerId: 1,
        paddleData: 1,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await Organization.updateOne({ _id: organizationId }, { $set: { plan } });
}

export type RedeemResult =
  | { ok: true; tierGranted: Plan; couponCode: string }
  | { ok: false; failure: CouponFailure; currentPlan?: string | null };

/**
 * Redeem a coupon for the caller's organisation.
 *
 * Concurrency: the capacity check and the increment are ONE conditional write.
 * A naive validate-then-increment lets two requests both pass validation on the
 * final slot and both get upgraded — on a launch-day spike that over-issues
 * lifetime plans you are then contractually stuck honouring.
 *
 * Order: claim the slot, write the audit row (whose unique index is the final
 * arbiter against a double grant), then apply the entitlement. Every failure
 * after the claim releases the slot again, so a failed redemption never consumes
 * capacity.
 */
export async function redeemCoupon(input: {
  code: string;
  userId: string;
  userEmail: string;
  organizationId: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<RedeemResult> {
  const now = new Date();

  // Pre-flight: gives each rule its own distinct message. Capacity and
  // uniqueness are enforced again below, atomically.
  const pre = await validateCoupon({
    code: input.code,
    userId: input.userId,
    organizationId: input.organizationId,
    now,
  });
  if (!pre.ok) return { ok: false, failure: pre.failure, currentPlan: pre.currentPlan };

  const code = input.code.trim().toUpperCase();

  // ---- ATOMIC CLAIM -------------------------------------------------------
  // Re-asserts isActive, the validity window AND remaining capacity in the same
  // filter as the increment. $expr compares the two fields server-side, so no
  // read-modify-write window exists. If this returns null the coupon sold out
  // (or was switched off) between validation and now.
  const claimed = await Coupon.findOneAndUpdate(
    {
      code,
      isActive: true,
      validFrom: { $lte: now },
      $and: [
        { $or: [{ validUntil: null }, { validUntil: { $exists: false } }, { validUntil: { $gte: now } }] },
        { $expr: { $lt: ["$redemptionsCount", "$maxRedemptions"] } },
      ],
    },
    { $inc: { redemptionsCount: 1 } },
    { new: true },
  );
  if (!claimed) return { ok: false, failure: "sold_out" };

  const releaseSlot = async () => {
    try {
      await Coupon.updateOne({ _id: claimed._id }, { $inc: { redemptionsCount: -1 } });
    } catch (err) {
      // Losing the compensating write leaks one slot — noisy but not incorrect
      // (we under-issue rather than over-issue). Log loudly for reconciliation.
      logger.error("[coupon] failed to release claimed slot", {
        couponId: String(claimed._id),
        err: (err as Error).message,
      });
    }
  };

  // ---- AUDIT ROW ----------------------------------------------------------
  // Written before the grant so the unique (couponId, organizationId) index can
  // reject a racing duplicate BEFORE any entitlement is applied.
  let redemptionId: mongoose.Types.ObjectId;
  try {
    const redemption = await CouponRedemption.create({
      couponId: claimed._id,
      couponCode: claimed.code,
      userId: input.userId,
      userEmail: input.userEmail,
      organizationId: input.organizationId,
      tierGranted: claimed.grantsTier,
      redeemedAt: now,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    redemptionId = redemption._id;
  } catch (err) {
    await releaseSlot();
    // Duplicate key = this org redeemed concurrently on another request.
    if ((err as { code?: number }).code === 11000) {
      return { ok: false, failure: "already_used" };
    }
    throw err;
  }

  // ---- ENTITLEMENT --------------------------------------------------------
  try {
    await grantPlan(input.organizationId, claimed.grantsTier as Plan, {
      _id: claimed._id,
      code: claimed.code,
    });
  } catch (err) {
    // Roll back both the slot and the audit row: this redemption never happened,
    // so leaving either behind would misreport capacity and history. This is the
    // ONLY path that deletes from the otherwise append-only log.
    await CouponRedemption.deleteOne({ _id: redemptionId }).catch(() => undefined);
    await releaseSlot();
    throw err;
  }

  return { ok: true, tierGranted: claimed.grantsTier as Plan, couponCode: claimed.code };
}

// ------------------------------------------------------------- bulk create

export type BulkGenerateResult = { codes: string[]; requested: number; created: number };

/** Hard ceiling on one bulk request. */
export const BULK_MAX = 1000;

/**
 * Generate `count` codes and insert them.
 *
 * Collisions are resolved by the unique index rejecting the insert, not by a
 * SELECT-then-INSERT existence check per code — that is both racy and O(n)
 * round-trips at 1000 codes. `insertMany({ ordered: false })` inserts every
 * non-colliding document in one round trip and reports the rest, which we then
 * retry with fresh codes.
 */
export async function bulkGenerateCoupons(input: {
  count: number;
  partner?: string;
  base: Omit<Partial<CouponDocType>, "code">;
}): Promise<BulkGenerateResult> {
  const target = Math.min(Math.max(input.count, 1), BULK_MAX);
  const created: string[] = [];

  // Bounded retries: each pass only re-generates what actually collided, so with
  // a 32^8 space this converges on the first pass in practice.
  for (let attempt = 0; attempt < 5 && created.length < target; attempt++) {
    const remaining = target - created.length;
    const candidates = new Set<string>();
    while (candidates.size < remaining) candidates.add(generateCouponCode(input.partner));

    const docs = [...candidates].map((code) => ({ ...input.base, code }));
    try {
      const inserted = await Coupon.insertMany(docs, { ordered: false });
      created.push(...inserted.map((d) => d.code));
    } catch (err) {
      // With ordered:false Mongo inserts everything it can and throws a
      // BulkWriteError describing only the failures.
      const bulk = err as { insertedDocs?: Array<{ code: string }>; writeErrors?: unknown[] };
      if (bulk.insertedDocs?.length) created.push(...bulk.insertedDocs.map((d) => d.code));
      if (!bulk.writeErrors?.length) throw err;
    }
  }

  return { codes: created, requested: target, created: created.length };
}
