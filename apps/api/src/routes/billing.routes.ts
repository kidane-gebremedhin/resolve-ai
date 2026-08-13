import { Router, type Request, type Response } from "express";
import express from "express";
import { z } from "zod";
import { Organization, Subscription } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { requireOrgRole } from "../middleware/org-role.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import {
  handlePaddleEvent,
  verifyPaddleSignature,
  createCheckoutSession,
  createCustomerPortalSession,
  activateFromTransaction,
  changePlan,
} from "../services/billing.service.js";
import { limitsForPlan } from "../middleware/plan-limit.middleware.js";
import { loadPlanCatalog } from "../config/plans.js";
import { Message, KnowledgeSource, Website, Membership, UsageRecord } from "../models/index.js";
import { logger } from "../config/logger.js";
import { dailyMetric } from "../services/analytics.service.js";
import { budgetLimitsForPlan } from "../config/plans.js";
import mongoose from "mongoose";

const router = Router();

// Public plan catalog — single source of truth for the billing + pricing pages
// (prices, features, limits, Paddle price ids). No auth: the marketing pricing
// page is public.
router.get("/plans", async (_req: Request, res: Response) => {
  res.json({ plans: await loadPlanCatalog() });
});

// Webhook must consume the raw body to verify HMAC.
router.post(
  "/webhook",
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req: Request, res: Response) => {
    const raw = req.body instanceof Buffer ? req.body.toString("utf8") : "";
    const sig = req.headers["paddle-signature"] as string | undefined;
    if (!verifyPaddleSignature(raw, sig)) {
      res.status(401).json({ error: { code: "invalid_signature", message: "Bad signature." } });
      return;
    }
    try {
      const event = JSON.parse(raw);
      await handlePaddleEvent(event);
      res.status(204).send();
    } catch (err) {
      logger.error("[billing] webhook handling failed", err);
      res.status(500).json({ error: { code: "webhook_error", message: "Failed to process event." } });
    }
  },
);

router.get("/subscription", requireAuth, requireOrg, requireOrgRole("admin"), async (req: Request, res: Response) => {
  const sub = await Subscription.findOne({ organizationId: req.orgId });
  const org = await Organization.findById(req.orgId).select("plan").lean();
  // `active` is the gate signal: a real subscription in an entitled state. When
  // there is no subscription we report status "none" (NOT "active") so the
  // dashboard gate redirects unpaid orgs to checkout.
  const active = Boolean(sub && (sub.status === "active" || sub.status === "trialing"));

  // Prefer the stored billingInterval field; fall back to deriving from paddleData.
  let billingInterval: "month" | "year" = (sub?.billingInterval as "month" | "year" | undefined) ?? "month";
  if (!sub?.billingInterval) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subPriceId: string | undefined = (sub?.paddleData as any)?.data?.items?.[0]?.price?.id;
    if (subPriceId) {
      const catalog = await loadPlanCatalog();
      const yearlyIds = new Set(catalog.map((c) => c.priceIdYearly).filter(Boolean));
      if (yearlyIds.has(subPriceId)) billingInterval = "year";
    }
  }

  res.json({
    plan: sub?.plan ?? org?.plan ?? null,
    status: sub?.status ?? "none",
    active,
    // How the entitlement was obtained. A "coupon" subscription has no Paddle
    // object behind it, so the billing UI must not offer portal/cancel for it
    // (the paddleCustomerId below is null for those, which already drives that).
    source: sub?.source ?? "paddle",
    couponCode: sub?.couponCode ?? null,
    billingInterval,
    paddleSubscriptionId: sub?.paddleSubscriptionId ?? null,
    paddleCustomerId: sub?.paddleCustomerId ?? null,
    currentPeriodStart: sub?.currentPeriodStart ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    canceledAt: sub?.canceledAt ?? null,
    cancelScheduledAt: sub?.cancelScheduledAt ?? null,
  });
});

router.get("/usage", requireAuth, requireOrg, requireOrgRole("admin"), async (req: Request, res: Response) => {
  const org = await Organization.findById(req.orgId).select("plan").lean();
  const limits = limitsForPlan(org?.plan);
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const [messages, knowledgeSources, websites, teamMembers] = await Promise.all([
    Message.countDocuments({ organizationId: req.orgId, createdAt: { $gte: start } }),
    KnowledgeSource.countDocuments({ organizationId: req.orgId }),
    Website.countDocuments({ organizationId: req.orgId }),
    Membership.countDocuments({ organizationId: req.orgId, status: "active" }),
  ]);

  res.json({
    plan: org?.plan ?? null,
    period: { start: start.toISOString(), end: null },
    usage: {
      messages: { used: messages, limit: limits.messagesPerMonth },
      knowledgeSources: { used: knowledgeSources, limit: limits.knowledgeSources },
      websites: { used: websites, limit: limits.websites },
      teamMembers: { used: teamMembers, limit: limits.teamMembers },
    },
  });
});

const checkoutSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url().optional(),
});

router.post(
  "/checkout",
  requireAuth,
  requireOrg,
  validateBody(checkoutSchema),
  async (req: Request, res: Response) => {
    const result = await createCheckoutSession({
      organizationId: req.orgId!,
      priceId: req.body.priceId,
      successUrl: req.body.successUrl,
    });
    res.json(result);
  },
);

router.post("/portal", requireAuth, requireOrg, requireOrgRole("admin"), async (req: Request, res: Response) => {
  const result = await createCustomerPortalSession({ organizationId: req.orgId! });
  res.json(result);
});

// Activate the org's subscription from a just-completed checkout transaction,
// without waiting for the webhook. Called by the checkout page on
// `checkout.completed` so the dashboard unlocks immediately.
const activateSchema = z.object({ transactionId: z.string().min(1) });
router.post(
  "/activate",
  requireAuth,
  requireOrg,
  validateBody(activateSchema),
  async (req: Request, res: Response) => {
    try {
      const active = await activateFromTransaction(req.body.transactionId, req.orgId!);
      res.json({ active });
    } catch (err) {
      logger.error("[billing] activate failed", { err: (err as Error).message });
      res.json({ active: false });
    }
  },
);

// Schedule a plan change at the end of the current billing period (no proration).
// Calls Paddle's subscription update API with proration_billing_mode=do_not_bill.
const changePlanSchema = z.object({ priceId: z.string().min(1) });
router.post(
  "/change-plan",
  requireAuth,
  requireOrg,
  validateBody(changePlanSchema),
  async (req: Request, res: Response) => {
    try {
      const result = await changePlan({ organizationId: req.orgId!, priceId: req.body.priceId });
      res.json(result);
    } catch (err) {
      logger.error("[billing] change-plan failed", err);
      res
        .status(400)
        .json({ error: { code: "change_plan_error", message: (err as Error).message } });
    }
  },
);

// Daily time-series usage for the current org. Returns the last `days` days
// (max 180). Each point includes the day's message count and the count of
// knowledge sources whose ingestion finalized that day (lastSyncedAt).
router.get("/usage/daily", requireAuth, requireOrg, requireOrgRole("admin"), async (req: Request, res: Response) => {
  const rawDays = (req.query.days as string | undefined) ?? "30";
  const days = Math.min(Math.max(Number(rawDays) || 30, 1), 180);

  const [messages, knowledge] = await Promise.all([
    dailyMetric({
      collection: Message as unknown as Parameters<typeof dailyMetric>[0]["collection"],
      dateField: "createdAt",
      organizationId: req.orgId,
      days,
    }),
    dailyMetric({
      collection: KnowledgeSource as unknown as Parameters<typeof dailyMetric>[0]["collection"],
      dateField: "lastSyncedAt",
      organizationId: req.orgId,
      days,
      match: { embeddingStatus: "synced" },
    }),
  ]);

  const kbByDate = new Map(knowledge.map((p) => [p.date, p.value]));
  const points = messages.map((p) => ({
    date: p.date,
    messages: p.value,
    knowledgeIngested: kbByDate.get(p.date) ?? 0,
  }));
  res.json({ points });
});

function currentPeriod(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${mm}`;
}

// Current-month USD spending summary for the org + per-plan budget limits.
router.get("/usage/cost", requireAuth, requireOrg, requireOrgRole("admin"), async (req: Request, res: Response) => {
  const org = await Organization.findById(req.orgId).select("plan").lean();
  const period = currentPeriod();
  const orgOid = new mongoose.Types.ObjectId(req.orgId!);

  const [spendAgg] = await UsageRecord.aggregate<{ total: number }>([
    { $match: { organizationId: orgOid, period } },
    { $group: { _id: null, total: { $sum: "$costUsd" } } },
  ]);
  const spentUsd = spendAgg?.total ?? 0;
  const budgetLimits = await budgetLimitsForPlan(org?.plan);

  res.json({
    period,
    spentUsd: parseFloat(spentUsd.toFixed(6)),
    orgMonthlyLimitUsd: budgetLimits.orgMonthlyLimitUsd,
    websiteMonthlyLimitUsd: budgetLimits.websiteMonthlyLimitUsd,
    plan: org?.plan ?? null,
  });
});

// Per-website USD spending breakdown for the current month.
router.get("/usage/cost/websites", requireAuth, requireOrg, requireOrgRole("admin"), async (req: Request, res: Response) => {
  const period = currentPeriod();
  const orgOid = new mongoose.Types.ObjectId(req.orgId!);
  const org = await Organization.findById(req.orgId).select("plan").lean();

  const websiteAgg = await UsageRecord.aggregate<{ _id: unknown; spentUsd: number }>([
    { $match: { organizationId: orgOid, period, websiteId: { $ne: null } } },
    { $group: { _id: "$websiteId", spentUsd: { $sum: "$costUsd" } } },
  ]);

  const websiteIds = websiteAgg.map((a) => a._id);
  const websites = await Website.find({ _id: { $in: websiteIds } })
    .select("name domain")
    .lean();
  const websiteMap = new Map(websites.map((w) => [String(w._id), w]));

  const budgetLimits = await budgetLimitsForPlan(org?.plan);

  res.json({
    period,
    websiteMonthlyLimitUsd: budgetLimits.websiteMonthlyLimitUsd,
    websites: websiteAgg.map((a) => {
      const w = websiteMap.get(String(a._id));
      return {
        websiteId: String(a._id),
        name: w?.name ?? "Unknown",
        domain: w?.domain ?? "",
        spentUsd: parseFloat(a.spentUsd.toFixed(6)),
      };
    }),
  });
});

// Daily USD cost time series for the current org (last N days).
router.get("/usage/cost/daily", requireAuth, requireOrg, requireOrgRole("admin"), async (req: Request, res: Response) => {
  const rawDays = (req.query.days as string | undefined) ?? "30";
  const days = Math.min(Math.max(Number(rawDays) || 30, 1), 180);
  const since = new Date();
  since.setDate(since.getDate() - days);
  const orgOid = new mongoose.Types.ObjectId(req.orgId!);

  const agg = await UsageRecord.aggregate<{ _id: string; costUsd: number }>([
    { $match: { organizationId: orgOid, createdAt: { $gte: since } } },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" },
        },
        costUsd: { $sum: "$costUsd" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Fill missing days with 0 so the chart has a continuous x-axis.
  const byDate = new Map(agg.map((a) => [a._id, a.costUsd]));
  const points: Array<{ date: string; costUsd: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    points.push({ date: key, costUsd: parseFloat((byDate.get(key) ?? 0).toFixed(6)) });
  }

  res.json({ points });
});

export default router;
