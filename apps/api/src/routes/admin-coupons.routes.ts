// Platform-admin coupon management. Mounted at /admin/coupons.
//
// Kept in its own router rather than bolted onto the already-large
// admin.routes.ts, but guarded identically — requireAuth + requirePlatformAdmin
// applied to the whole router, so the role is re-checked server-side on every
// request and never taken from the client.

import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Coupon, CouponRedemption } from "../models/index.js";
import { PLAN_KEYS } from "../config/plans.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { paginate, paginateAggregate, parseListParams, searchFilter } from "../utils/list-query.js";
import { BULK_MAX, bulkGenerateCoupons, generateCouponCode } from "../services/coupon.service.js";

const router = Router();
router.use(requireAuth, requirePlatformAdmin);

// ---------- GET /admin/coupons ----------
// Filters: isActive, partner, grantsTier. Paginated.
//
// The redemption counts come from ONE aggregate: a $lookup with a $count
// sub-pipeline that runs AFTER $skip/$limit (see paginateAggregate), so it only
// touches the current page — never a query per coupon in a loop.
router.get("/", async (req: Request, res: Response) => {
  const params = parseListParams(req.query as Record<string, unknown>);

  const match: Record<string, unknown> = {};
  if (req.query.isActive === "true") match.isActive = true;
  if (req.query.isActive === "false") match.isActive = false;
  if (typeof req.query.partner === "string" && req.query.partner.trim()) {
    match.partner = req.query.partner.trim();
  }
  if (typeof req.query.grantsTier === "string" && PLAN_KEYS.includes(req.query.grantsTier as never)) {
    match.grantsTier = req.query.grantsTier;
  }
  Object.assign(match, searchFilter(params.q, ["code", "partner", "campaign", "description"]));

  const page = await paginateAggregate(
    Coupon,
    match,
    [
      {
        $lookup: {
          from: "couponredemptions",
          localField: "_id",
          foreignField: "couponId",
          as: "redemptionStats",
          pipeline: [{ $count: "n" }],
        },
      },
      {
        $addFields: {
          // `redemptionsCount` is the claimed-slot counter the atomic write
          // maintains; `actualRedemptions` is the audit log's own count. They
          // should match — a gap means a slot was claimed and never released
          // after a failed grant, which is worth seeing rather than hiding.
          actualRedemptions: { $ifNull: [{ $first: "$redemptionStats.n" }, 0] },
        },
      },
      { $project: { redemptionStats: 0 } },
    ],
    { params, sort: { createdAt: -1 } },
  );

  res.json(page);
});

// ---------- POST /admin/coupons ----------
const baseCouponSchema = {
  grantsTier: z.enum(PLAN_KEYS),
  // The model allows any positive cap; the validator must not contradict it.
  maxRedemptions: z.number().int().min(1),
  maxPerUser: z.number().int().min(1).default(1),
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  isActive: z.boolean().default(true),
  partner: z.string().trim().max(64).optional(),
  campaign: z.string().trim().max(64).optional(),
  description: z.string().max(2000).optional(),
  internalNotes: z.string().max(4000).optional(),
};

// A plain object with a cross-field refinement rather than a discriminated
// union: zod discriminates on the RAW input, so a `.default(false)` on the
// discriminator never applies and omitting `bulk` would fail to match any
// branch — which silently 400s the ordinary single-coupon create.
const createCouponSchema = z
  .object({
    bulk: z.boolean().default(false),
    /** Required when bulk is true. Capped so one request can't mint unbounded codes. */
    count: z.number().int().min(1).max(BULK_MAX).optional(),
    // Omit to auto-generate. Uppercased so it matches how it will be stored.
    code: z.string().trim().min(3).max(64).toUpperCase().optional(),
    ...baseCouponSchema,
  })
  .superRefine((v, ctx) => {
    if (v.bulk && v.count === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["count"],
        message: "count is required when bulk is true.",
      });
    }
    if (v.bulk && v.code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["code"],
        message: "code cannot be supplied for a bulk generation.",
      });
    }
  });

router.post("/", validateBody(createCouponSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof createCouponSchema>;
  const createdBy = new mongoose.Types.ObjectId(req.auth!.userId);

  const base = {
    grantsTier: body.grantsTier,
    maxRedemptions: body.maxRedemptions,
    maxPerUser: body.maxPerUser,
    validFrom: body.validFrom ?? new Date(),
    validUntil: body.validUntil ?? null,
    isActive: body.isActive,
    partner: body.partner,
    campaign: body.campaign,
    description: body.description,
    internalNotes: body.internalNotes,
    createdBy,
  };

  if (body.bulk) {
    const result = await bulkGenerateCoupons({
      // superRefine above guarantees count is present when bulk is true.
      count: body.count!,
      partner: body.partner,
      base,
    });
    // Report shortfalls rather than silently returning fewer codes than asked
    // for — these get handed to an LTD platform and the count matters.
    res.status(201).json(result);
    return;
  }

  const code = body.code ?? generateCouponCode(body.partner);
  try {
    const coupon = await Coupon.create({ ...base, code });
    res.status(201).json(coupon);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new ConflictError(`Coupon code "${code}" already exists.`);
    }
    throw err;
  }
});

// ---------- PATCH /admin/coupons/:id ----------
// `code` and `grantsTier` are immutable: codes are already in customers' hands,
// and changing the tier would silently re-price everyone who redeems next.
const patchCouponSchema = z
  .object({
    isActive: z.boolean().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    maxRedemptions: z.number().int().min(1).optional(),
    description: z.string().max(2000).optional(),
    internalNotes: z.string().max(4000).optional(),
  })
  .strict();

router.patch("/:id", validateBody(patchCouponSchema), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) throw new NotFoundError("Coupon not found.");

  const existing = await Coupon.findById(id);
  if (!existing) throw new NotFoundError("Coupon not found.");

  // Lowering the cap below what has already gone out would make
  // `redemptionsCount > maxRedemptions`, which reads as negative remaining
  // capacity everywhere. Refuse rather than corrupt the counter.
  if (
    req.body.maxRedemptions !== undefined &&
    req.body.maxRedemptions < existing.redemptionsCount
  ) {
    throw new ValidationError(
      `maxRedemptions cannot be below the ${existing.redemptionsCount} redemption(s) already issued.`,
    );
  }

  const updated = await Coupon.findByIdAndUpdate(
    id,
    { $set: req.body },
    { new: true, runValidators: true },
  );
  res.json(updated);
});

// ---------- DELETE /admin/coupons/:id ----------
// Refused once anything has been redeemed: the redemption log references this
// coupon, and deleting it would orphan the audit trail for plans we are still
// honouring. Deactivating is the correct way to take a live code out of service.
router.delete("/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) throw new NotFoundError("Coupon not found.");

  const redemptions = await CouponRedemption.countDocuments({ couponId: id });
  if (redemptions > 0) {
    throw new ConflictError(
      `This coupon has ${redemptions} redemption(s) and cannot be deleted. Set isActive to false instead.`,
    );
  }

  const deleted = await Coupon.findByIdAndDelete(id);
  if (!deleted) throw new NotFoundError("Coupon not found.");
  res.status(204).end();
});

// ---------- GET /admin/coupons/:id/redemptions ----------
router.get("/:id/redemptions", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) throw new NotFoundError("Coupon not found.");
  const params = parseListParams(req.query as Record<string, unknown>);

  const page = await paginate(CouponRedemption, { couponId: id }, {
    params,
    sort: { redeemedAt: -1 },
  });
  res.json(page);
});

export default router;
