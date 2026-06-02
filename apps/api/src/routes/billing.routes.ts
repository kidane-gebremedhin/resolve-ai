import { Router, type Request, type Response } from "express";
import express from "express";
import { z } from "zod";
import { Organization, Subscription } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import {
  handlePaddleEvent,
  verifyPaddleSignature,
  createCheckoutSession,
  createCustomerPortalSession,
} from "../services/billing.service.js";
import { limitsForPlan } from "../middleware/plan-limit.middleware.js";
import { Message, KnowledgeSource, Website, Membership } from "../models/index.js";
import { logger } from "../config/logger.js";
import { dailyMetric } from "../services/analytics.service.js";

const router = Router();

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

router.get("/subscription", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const sub = await Subscription.findOne({ organizationId: req.orgId });
  const org = await Organization.findById(req.orgId).select("plan").lean();
  res.json({
    plan: sub?.plan ?? org?.plan ?? "free",
    status: sub?.status ?? "active",
    paddleSubscriptionId: sub?.paddleSubscriptionId ?? null,
    paddleCustomerId: sub?.paddleCustomerId ?? null,
    currentPeriodStart: sub?.currentPeriodStart ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    canceledAt: sub?.canceledAt ?? null,
  });
});

router.get("/usage", requireAuth, requireOrg, async (req: Request, res: Response) => {
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
    plan: org?.plan ?? "free",
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

router.post("/portal", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const result = await createCustomerPortalSession({ organizationId: req.orgId! });
  res.json(result);
});

// Daily time-series usage for the current org. Returns the last `days` days
// (max 180). Each point includes the day's message count and the count of
// knowledge sources whose ingestion finalized that day (lastSyncedAt).
router.get("/usage/daily", requireAuth, requireOrg, async (req: Request, res: Response) => {
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

export default router;
