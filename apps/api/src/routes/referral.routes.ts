// Affiliate dashboard endpoints for the signed-in user: their referral code +
// share funnel + earnings. The share URL is built client-side from the code.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { Referral } from "../models/index.js";
import { ensureReferralCode } from "../services/affiliate.service.js";

const router = Router();
router.use(requireAuth);

router.get("/me", async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const code = await ensureReferralCode(userId);
  const referrals = await Referral.find({ referrerUserId: userId })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const counts: Record<string, number> = { pending: 0, earned: 0, paid: 0, void: 0 };
  let earnedCents = 0;
  let paidCents = 0;
  for (const r of referrals) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (r.status === "earned") earnedCents += r.commissionCents ?? 0;
    if (r.status === "paid") paidCents += r.commissionCents ?? 0;
  }

  res.json({
    code,
    counts,
    earnedCents,
    paidCents,
    referrals: referrals.map((r) => ({
      _id: r._id,
      status: r.status,
      plan: r.plan ?? null,
      commissionCents: r.commissionCents ?? 0,
      createdAt: r.createdAt,
      earnedAt: r.earnedAt ?? null,
    })),
  });
});

router.post("/code", async (req: Request, res: Response) => {
  const code = await ensureReferralCode(req.auth!.userId);
  res.json({ code });
});

export default router;
