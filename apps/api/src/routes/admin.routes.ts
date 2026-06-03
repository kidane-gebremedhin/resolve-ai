// Platform-admin only routes.
import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  Agent,
  Campaign,
  Conversation,
  KnowledgeSource,
  Membership,
  Message,
  Organization,
  PlatformSetting,
  Referral,
  Subscription,
  User,
} from "../models/index.js";

// Curated font keys (must match apps/web/src/app/fonts.ts).
const SANS_KEYS = ["inter", "open-sans", "montserrat"] as const;
const DISPLAY_KEYS = ["inter-tight", "lora", "montserrat"] as const;
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import {
  adminTimeSeries,
  churnRate30d,
  computeMrr,
  conversationBuckets,
  signupBuckets,
} from "../services/analytics.service.js";
import { syncSubscriptionFromPaddle } from "../services/billing.service.js";

const router = Router();
router.use(requireAuth, requirePlatformAdmin);

router.get("/stats", async (_req: Request, res: Response) => {
  const [
    totalOrganizations,
    totalUsers,
    activeSubscriptions,
    totalConversations,
    totalKnowledgeSources,
    mrr,
    signups,
    conversations,
    churn,
  ] = await Promise.all([
    Organization.countDocuments(),
    User.countDocuments(),
    Subscription.countDocuments({ status: { $in: ["active", "trialing"] } }),
    Conversation.countDocuments(),
    KnowledgeSource.countDocuments(),
    computeMrr(),
    signupBuckets(),
    conversationBuckets(),
    churnRate30d(),
  ]);

  res.json({
    totalUsers,
    totalOrganizations,
    activeSubscriptions,
    totalConversations,
    totalKnowledgeSources,
    mrr,
    signups,
    conversations,
    churnRate: churn,
    // Back-compat aliases for older clients that still read these names.
    organizations: totalOrganizations,
    users: totalUsers,
  });
});

router.get("/users", async (req: Request, res: Response) => {
  const { q, limit = "50" } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (q) filter.email = { $regex: q, $options: "i" };
  const users = await User.find(filter)
    .select("email name role provider createdAt lastLoginAt")
    .limit(Math.min(Number(limit), 200));
  res.json(users);
});

router.get("/subscriptions", async (_req: Request, res: Response) => {
  const subs = await Subscription.find().sort({ createdAt: -1 }).limit(200);
  res.json(subs);
});

// Reconcile a subscription from Paddle (replaces the old no-op "Refresh status").
router.post("/subscriptions/:id/sync", async (req: Request, res: Response) => {
  const sub = await Subscription.findById(req.params.id).select("paddleSubscriptionId").lean();
  if (!sub?.paddleSubscriptionId) {
    res.status(404).json({ error: { code: "not_found", message: "Subscription not found." } });
    return;
  }
  await syncSubscriptionFromPaddle(sub.paddleSubscriptionId);
  const updated = await Subscription.findById(req.params.id);
  res.json(updated);
});

// Paginated listing of organizations with aggregated counts. Uses a single
// $lookup pipeline so each row is one DB round trip overall.
router.get("/organizations", async (req: Request, res: Response) => {
  const { cursor, limit: rawLimit } = req.query as Record<string, string | undefined>;
  const limit = Math.min(Math.max(Number(rawLimit ?? "50") || 50, 1), 100);

  const match: Record<string, unknown> = {};
  if (cursor && mongoose.isValidObjectId(cursor)) {
    match._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const items = await Organization.aggregate([
    { $match: match },
    { $sort: { _id: -1 } },
    { $limit: limit + 1 },
    {
      $lookup: {
        from: "memberships",
        let: { orgId: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$organizationId", "$$orgId"] }, { $eq: ["$status", "active"] }] } } },
          { $count: "n" },
        ],
        as: "_members",
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        let: { orgId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$organizationId", "$$orgId"] } } },
          { $project: { plan: 1, status: 1 } },
          { $limit: 1 },
        ],
        as: "_sub",
      },
    },
    {
      $lookup: {
        from: "conversations",
        let: { orgId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$organizationId", "$$orgId"] } } },
          { $count: "n" },
        ],
        as: "_conv",
      },
    },
    {
      $lookup: {
        from: "knowledgesources",
        let: { orgId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$organizationId", "$$orgId"] } } },
          { $count: "n" },
        ],
        as: "_kb",
      },
    },
    {
      $project: {
        _id: 1,
        name: 1,
        slug: 1,
        plan: 1,
        createdAt: 1,
        memberCount: { $ifNull: [{ $arrayElemAt: ["$_members.n", 0] }, 0] },
        conversationCount: { $ifNull: [{ $arrayElemAt: ["$_conv.n", 0] }, 0] },
        knowledgeSourceCount: { $ifNull: [{ $arrayElemAt: ["$_kb.n", 0] }, 0] },
        subscriptionPlan: {
          $ifNull: [{ $arrayElemAt: ["$_sub.plan", 0] }, "$plan"],
        },
        subscriptionStatus: { $arrayElemAt: ["$_sub.status", 0] },
      },
    },
  ]);

  // Membership/KS counts above use $lookup so MongoDB returns counts even when 0.
  // The Membership ref above lets us reuse model registration:
  void Membership;

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? String(page[page.length - 1]._id) : null;
  res.json({ items: page, nextCursor });
});

// Paginated cross-tenant listing of agents with org name, website domain, and
// conversation count. Same cursor pattern as /organizations.
router.get("/agents", async (req: Request, res: Response) => {
  const { cursor, limit: rawLimit } = req.query as Record<string, string | undefined>;
  const limit = Math.min(Math.max(Number(rawLimit ?? "50") || 50, 1), 100);

  const match: Record<string, unknown> = {};
  if (cursor && mongoose.isValidObjectId(cursor)) {
    match._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const items = await Agent.aggregate([
    { $match: match },
    { $sort: { _id: -1 } },
    { $limit: limit + 1 },
    {
      $lookup: {
        from: "organizations",
        localField: "organizationId",
        foreignField: "_id",
        as: "_org",
      },
    },
    {
      $lookup: {
        from: "websites",
        localField: "websiteId",
        foreignField: "_id",
        as: "_site",
      },
    },
    {
      $lookup: {
        from: "conversations",
        let: { agentId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$agentId", "$$agentId"] } } },
          { $count: "n" },
        ],
        as: "_conv",
      },
    },
    {
      $project: {
        _id: 1,
        name: 1,
        model: 1,
        isActive: 1,
        createdAt: 1,
        organizationId: 1,
        organizationName: { $arrayElemAt: ["$_org.name", 0] },
        websiteDomain: { $arrayElemAt: ["$_site.domain", 0] },
        conversationCount: { $ifNull: [{ $arrayElemAt: ["$_conv.n", 0] }, 0] },
      },
    },
  ]);

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? String(page[page.length - 1]._id) : null;
  res.json({ items: page, nextCursor });
});

router.get("/timeseries", async (req: Request, res: Response) => {
  const { metric = "signups", days: rawDays } = req.query as Record<string, string | undefined>;
  const allowed = ["signups", "conversations", "messages", "mrr_snapshot"] as const;
  type Metric = (typeof allowed)[number];
  if (!(allowed as readonly string[]).includes(metric)) {
    res.status(400).json({
      error: { code: "invalid_metric", message: `metric must be one of: ${allowed.join(", ")}` },
    });
    return;
  }
  const days = Math.min(Math.max(Number(rawDays ?? "30") || 30, 1), 180);
  const points = await adminTimeSeries(metric as Metric, days);
  res.json({ points });
});

// ---------- Affiliate referrals ----------
router.get("/referrals", async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (status && ["pending", "earned", "paid", "void"].includes(status)) filter.status = status;
  const referrals = await Referral.find(filter)
    .sort({ createdAt: -1 })
    .limit(500)
    .populate("referrerUserId", "email name")
    .populate("referredOrganizationId", "name slug plan")
    .lean();
  res.json({ referrals });
});

router.post("/referrals/:id/mark-paid", async (req: Request, res: Response) => {
  const ref = await Referral.findById(req.params.id);
  if (!ref) {
    res.status(404).json({ error: { code: "not_found", message: "Referral not found." } });
    return;
  }
  if (ref.status !== "earned") {
    res.status(400).json({ error: { code: "invalid_state", message: "Only earned referrals can be paid." } });
    return;
  }
  ref.status = "paid";
  ref.paidAt = new Date();
  if (typeof req.body?.payoutRef === "string") ref.payoutRef = req.body.payoutRef;
  await ref.save();
  res.json(ref);
});

// ---------- AI insights: resolution mix + agent confidence ----------
// Auto-resolution (AI) vs human escalation, and the distribution of AI-message
// confidence scores. Platform-wide across all tenants.
router.get("/insights", async (_req: Request, res: Response) => {
  const [aiResolved, operatorResolved, escalated, totalConversations, confidence] =
    await Promise.all([
      Conversation.countDocuments({ resolvedBy: "ai" }),
      Conversation.countDocuments({ resolvedBy: "operator" }),
      Conversation.countDocuments({ escalatedAt: { $ne: null } }),
      Conversation.countDocuments(),
      Message.aggregate([
        { $match: { role: "ai", confidence: { $type: "number" } } },
        {
          $facet: {
            stats: [{ $group: { _id: null, average: { $avg: "$confidence" }, count: { $sum: 1 } } }],
            buckets: [
              {
                $bucket: {
                  groupBy: "$confidence",
                  boundaries: [0, 0.2, 0.4, 0.6, 0.8, 1.01],
                  default: "other",
                  output: { count: { $sum: 1 } },
                },
              },
            ],
          },
        },
      ]),
    ]);

  const facet = (confidence[0] ?? { stats: [], buckets: [] }) as {
    stats: { average?: number; count?: number }[];
    buckets: { _id: number | string; count: number }[];
  };
  const stats = facet.stats?.[0] ?? { average: 0, count: 0 };
  const BUCKET_LABELS = ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"];
  const BUCKET_LOWER = [0, 0.2, 0.4, 0.6, 0.8];
  const bucketCounts = new Map<number, number>(
    (facet.buckets ?? [])
      .filter((b) => typeof b._id === "number")
      .map((b) => [b._id as number, b.count]),
  );

  res.json({
    resolution: { aiResolved, operatorResolved, escalated, total: totalConversations },
    confidence: {
      average: stats.average ?? 0,
      count: stats.count ?? 0,
      buckets: BUCKET_LOWER.map((lower, i) => ({
        range: BUCKET_LABELS[i],
        count: bucketCounts.get(lower) ?? 0,
      })),
    },
  });
});

// ---------- Marketing campaigns ----------
// Each campaign has a tracking `code`; signups arriving with `?campaign=<code>`
// are attributed via Organization.campaignCode. Metrics: attributed signups +
// paid conversions (orgs whose plan is not free).
router.get("/campaigns", async (_req: Request, res: Response) => {
  const campaigns = await Campaign.find().sort({ createdAt: -1 }).limit(200).lean();
  // Aggregate attributed signups + conversions per campaign code in one pass.
  const agg = await Organization.aggregate([
    { $match: { campaignCode: { $type: "string", $ne: "" } } },
    {
      $group: {
        _id: "$campaignCode",
        signups: { $sum: 1 },
        conversions: { $sum: { $cond: [{ $ne: ["$plan", "free"] }, 1, 0] } },
      },
    },
  ]);
  const byCode = new Map(agg.map((a) => [a._id, a]));
  const items = campaigns.map((c) => {
    const m = byCode.get(c.code);
    const signups = m?.signups ?? 0;
    const conversions = m?.conversions ?? 0;
    return {
      ...c,
      metrics: {
        signups,
        conversions,
        conversionRate: signups > 0 ? conversions / signups : 0,
      },
    };
  });
  res.json({ items });
});

const campaignBodySchema = z.object({
  name: z.string().min(1).max(120),
  code: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i, "code must be alphanumeric (dashes/underscores allowed)"),
  channel: z.enum(["email", "social", "ads", "referral", "content", "other"]).optional(),
  status: z.enum(["active", "paused", "ended"]).optional(),
  description: z.string().max(500).optional(),
});

router.post("/campaigns", validateBody(campaignBodySchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof campaignBodySchema>;
  const exists = await Campaign.findOne({ code: body.code.toLowerCase() });
  if (exists) {
    res.status(409).json({ error: { code: "conflict", message: "A campaign with that code already exists." } });
    return;
  }
  const campaign = await Campaign.create({
    ...body,
    code: body.code.toLowerCase(),
    createdBy: req.auth?.userId ? new mongoose.Types.ObjectId(req.auth.userId) : undefined,
  });
  res.status(201).json(campaign);
});

const campaignPatchSchema = campaignBodySchema.partial().omit({ code: true });

router.patch("/campaigns/:id", validateBody(campaignPatchSchema), async (req: Request, res: Response) => {
  const campaign = await Campaign.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!campaign) {
    res.status(404).json({ error: { code: "not_found", message: "Campaign not found." } });
    return;
  }
  res.json(campaign);
});

router.delete("/campaigns/:id", async (req: Request, res: Response) => {
  await Campaign.findByIdAndDelete(req.params.id);
  res.json({ deleted: true });
});

// ---------- Platform settings (singleton) ----------
// Single global config document. On first read we lazily create it with the
// schema defaults so callers always see something they can edit.
const smtpSchema = z
  .object({
    host: z.string().max(255),
    port: z.number().int().min(1).max(65535),
    username: z.string().max(255),
    secret: z.string().max(1024), // TODO: encrypt at rest.
    fromEmail: z.string().email().or(z.literal("")),
  })
  .partial();

const securitySchema = z
  .object({
    mfaRequired: z.boolean(),
    sessionTimeoutMinutes: z.number().int().min(5).max(60 * 24 * 30),
    ipAllowlist: z.array(z.string().min(1).max(64)).max(200),
  })
  .partial();

const limitsSchema = z
  .object({
    maxOrgsPerUser: z.number().int().min(1).max(1000),
    defaultRateLimitPerMinute: z.number().int().min(1).max(1_000_000),
  })
  .partial();

const brandingSchema = z
  .object({
    platformName: z.string().min(1).max(120),
    supportEmail: z.string().email().or(z.literal("")),
  })
  .partial();

const themingSchema = z
  .object({
    fontSans: z.enum(SANS_KEYS),
    fontDisplay: z.enum(DISPLAY_KEYS),
  })
  .partial();

const affiliateSchema = z
  .object({
    enabled: z.boolean(),
    ratePercent: z.number().min(0).max(100),
    cookieDays: z.number().int().min(1).max(365),
  })
  .partial();

const planEntrySchema = z.object({
  plan: z.enum(["free", "starter", "pro", "enterprise"]),
  name: z.string().max(60).optional(),
  priceMonthlyUsd: z.number().min(0).max(1_000_000).nullable().optional(),
  features: z.array(z.string().max(160)).max(12).optional(),
  priceId: z.string().max(80).optional(),
});

const platformSettingsPatchSchema = z
  .object({
    smtp: smtpSchema,
    security: securitySchema,
    limits: limitsSchema,
    branding: brandingSchema,
    theming: themingSchema,
    affiliate: affiliateSchema,
    plans: z.array(planEntrySchema).max(8),
  })
  .partial();

async function loadOrInitSettings() {
  // findOneAndUpdate with upsert + setDefaultsOnInsert so the first hit
  // materialises the doc with every default field populated.
  return PlatformSetting.findOneAndUpdate(
    { singleton: "global" },
    { $setOnInsert: { singleton: "global" } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

router.get("/settings", async (_req: Request, res: Response) => {
  const settings = await loadOrInitSettings();
  res.json(settings);
});

router.patch(
  "/settings",
  validateBody(platformSettingsPatchSchema),
  async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof platformSettingsPatchSchema>;
    // Build a $set with dot-paths so partial nested updates merge instead of
    // overwriting whole sub-documents.
    const $set: Record<string, unknown> = {};
    for (const [group, fields] of Object.entries(body)) {
      // `plans` is an array — set it wholesale rather than dot-path merging.
      if (group === "plans") {
        if (Array.isArray(fields)) $set.plans = fields;
        continue;
      }
      if (!fields || typeof fields !== "object") continue;
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        $set[`${group}.${key}`] = value;
      }
    }
    if (req.auth?.userId) {
      $set.updatedBy = new mongoose.Types.ObjectId(req.auth.userId);
    }

    const settings = await PlatformSetting.findOneAndUpdate(
      { singleton: "global" },
      Object.keys($set).length > 0
        ? { $set, $setOnInsert: { singleton: "global" } }
        : { $setOnInsert: { singleton: "global" } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.json(settings);
  },
);

export default router;
