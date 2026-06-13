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
  UsageRecord,
} from "../models/index.js";
import {
  DEFAULT_PAGE_SIZE,
  dateRangeFilter,
  mergeFilters,
  paginate,
  paginateAggregate,
  parseListParams,
  searchFilter,
} from "../utils/list-query.js";
import { FONT_KEYS } from "../lib/font-keys.js";

// Curated font keys (mirror of apps/web/src/app/fonts.ts FONT_OPTIONS), generated
// by scripts/gen-fonts.mjs. Body and heading accept the SAME keys.
const SANS_KEYS = FONT_KEYS;
const DISPLAY_KEYS = FONT_KEYS;
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
  const params = parseListParams(req.query, { defaultPageSize: DEFAULT_PAGE_SIZE });
  const { role } = req.query as Record<string, string>;
  const filter = mergeFilters(
    searchFilter(params.q, ["email", "name"]),
    dateRangeFilter("createdAt", params.from, params.to),
    role === "platform_admin" || role === "user" ? { role } : {},
  );
  const page = await paginate(User, filter, {
    params,
    sort: { createdAt: -1 },
    select: "email name role provider createdAt lastLoginAt",
  });
  res.json(page);
});

router.get("/subscriptions", async (req: Request, res: Response) => {
  const params = parseListParams(req.query, { defaultPageSize: DEFAULT_PAGE_SIZE });
  const { plan, status } = req.query as Record<string, string | undefined>;
  const match = mergeFilters(
    searchFilter(params.q, ["paddleSubscriptionId", "paddleCustomerId"]),
    dateRangeFilter("createdAt", params.from, params.to),
    plan && ["pro", "business", "enterprise"].includes(plan) ? { plan } : {},
    status && ["active", "trialing", "past_due", "canceled", "paused"].includes(status) ? { status } : {},
  ) as Record<string, unknown>;

  const page = await paginateAggregate(
    Subscription,
    match,
    [
      { $lookup: { from: "organizations", localField: "organizationId", foreignField: "_id", as: "_org" } },
      { $set: { organizationName: { $arrayElemAt: ["$_org.name", 0] } } },
      { $project: { _org: 0 } },
    ],
    { params, sort: { createdAt: -1 } },
  );

  // MRR over ALL active/trialing subscriptions (not just this page), priced from
  // the admin-editable plan catalog so the header stat stays accurate.
  const setting = await PlatformSetting.findOne({ singleton: "global" }).lean();
  const priceByPlan = new Map(
    ((setting?.plans ?? []) as Array<{ plan?: string; priceMonthlyUsd?: number | null }>).map((p) => [
      p.plan,
      Number(p.priceMonthlyUsd) || 0,
    ]),
  );
  const grouped = await Subscription.aggregate([
    { $match: { status: { $in: ["active", "trialing"] } } },
    { $group: { _id: "$plan", n: { $sum: 1 } } },
  ]);
  const mrr = grouped.reduce((sum, g) => sum + (priceByPlan.get(g._id) ?? 0) * g.n, 0);

  res.json({ ...page, mrr });
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

// Paginated listing of organizations with aggregated counts. Supports search
// (name/slug), a plan filter, and a createdAt UTC date range.
router.get("/organizations", async (req: Request, res: Response) => {
  const params = parseListParams(req.query, { defaultPageSize: DEFAULT_PAGE_SIZE });
  const { plan } = req.query as Record<string, string | undefined>;
  const match = mergeFilters(
    searchFilter(params.q, ["name", "slug"]),
    dateRangeFilter("createdAt", params.from, params.to),
    plan && ["pro", "business", "enterprise"].includes(plan) ? { plan } : {},
  ) as Record<string, unknown>;

  // The Membership ref keeps the model registered for the $lookup below.
  void Membership;

  const page = await paginateAggregate(
    Organization,
    match,
    [
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
          pipeline: [{ $match: { $expr: { $eq: ["$organizationId", "$$orgId"] } } }, { $count: "n" }],
          as: "_conv",
        },
      },
      {
        $lookup: {
          from: "knowledgesources",
          let: { orgId: "$_id" },
          pipeline: [{ $match: { $expr: { $eq: ["$organizationId", "$$orgId"] } } }, { $count: "n" }],
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
          subscriptionPlan: { $ifNull: [{ $arrayElemAt: ["$_sub.plan", 0] }, "$plan"] },
          subscriptionStatus: { $arrayElemAt: ["$_sub.status", 0] },
        },
      },
    ],
    { params, sort: { _id: -1 } },
  );
  res.json(page);
});

// Paginated cross-tenant listing of agents with org name, website domain, and
// conversation count. Supports search (name), org/website/active filters, date.
router.get("/agents", async (req: Request, res: Response) => {
  const params = parseListParams(req.query, { defaultPageSize: DEFAULT_PAGE_SIZE });
  const { organizationId, websiteId, active } = req.query as Record<string, string | undefined>;
  const match = mergeFilters(
    searchFilter(params.q, ["name"]),
    dateRangeFilter("createdAt", params.from, params.to),
    organizationId && mongoose.isValidObjectId(organizationId)
      ? { organizationId: new mongoose.Types.ObjectId(organizationId) }
      : {},
    websiteId && mongoose.isValidObjectId(websiteId)
      ? { websiteId: new mongoose.Types.ObjectId(websiteId) }
      : {},
    active === "true" || active === "false" ? { isActive: active === "true" } : {},
  ) as Record<string, unknown>;

  const page = await paginateAggregate(
    Agent,
    match,
    [
      { $lookup: { from: "organizations", localField: "organizationId", foreignField: "_id", as: "_org" } },
      { $lookup: { from: "websites", localField: "websiteId", foreignField: "_id", as: "_site" } },
      {
        $lookup: {
          from: "conversations",
          let: { agentId: "$_id" },
          pipeline: [{ $match: { $expr: { $eq: ["$agentId", "$$agentId"] } } }, { $count: "n" }],
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
    ],
    { params, sort: { _id: -1 } },
  );
  res.json(page);
});

router.get("/timeseries", async (req: Request, res: Response) => {
  const {
    metric = "signups",
    days: rawDays,
    organizationId: rawOrg,
    agentId: rawAgent,
  } = req.query as Record<string, string | undefined>;
  const allowed = ["signups", "conversations", "messages", "mrr_snapshot"] as const;
  type Metric = (typeof allowed)[number];
  if (!(allowed as readonly string[]).includes(metric)) {
    res.status(400).json({
      error: { code: "invalid_metric", message: `metric must be one of: ${allowed.join(", ")}` },
    });
    return;
  }
  const days = Math.min(Math.max(Number(rawDays ?? "30") || 30, 1), 180);
  // Only accept well-formed ObjectId strings (ignore otherwise).
  const isObjectId = (v?: string) => !!v && /^[a-f0-9]{24}$/i.test(v);
  const points = await adminTimeSeries(metric as Metric, days, {
    organizationId: isObjectId(rawOrg) ? rawOrg : undefined,
    agentId: isObjectId(rawAgent) ? rawAgent : undefined,
  });
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
        conversions: { $sum: { $cond: [{ $in: ["$plan", ["pro", "business", "enterprise"]] }, 1, 0] } },
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
  plan: z.enum(["pro", "business", "enterprise"]),
  name: z.string().max(60).optional(),
  priceMonthlyUsd: z.number().min(0).max(1_000_000).nullable().optional(),
  features: z.array(z.string().max(160)).max(12).optional(),
  priceId: z.string().max(80).optional(),
});

const budgetLimitEntrySchema = z.object({
  plan: z.enum(["pro", "business", "enterprise"]),
  orgMonthlyLimitUsd: z.number().min(0).max(1_000_000),
  websiteMonthlyLimitUsd: z.number().min(0).max(1_000_000),
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
    budgetLimits: z.array(budgetLimitEntrySchema).max(3),
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

// ---------- Admin cost / usage overview ----------
// Aggregated USD spend for the current or specified month.
// Returns overall totals and top-N orgs by spend.
router.get("/usage/cost", async (req: Request, res: Response) => {
  const periodParam = req.query.period as string | undefined;
  let period = periodParam ?? (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();

  const [totalAgg] = await UsageRecord.aggregate<{ total: number; tokens: number }>([
    { $match: { period } },
    { $group: { _id: null, total: { $sum: "$costUsd" }, tokens: { $sum: "$totalTokens" } } },
  ]);

  const topOrgs = await UsageRecord.aggregate<{ _id: unknown; spentUsd: number; calls: number }>([
    { $match: { period } },
    {
      $group: {
        _id: "$organizationId",
        spentUsd: { $sum: "$costUsd" },
        calls: { $sum: 1 },
      },
    },
    { $sort: { spentUsd: -1 } },
    { $limit: 20 },
  ]);

  const orgIds = topOrgs.map((o) => o._id);
  const orgs = await Organization.find({ _id: { $in: orgIds } })
    .select("name plan")
    .lean();
  const orgMap = new Map(orgs.map((o) => [String(o._id), o]));

  res.json({
    period,
    totalCostUsd: parseFloat((totalAgg?.total ?? 0).toFixed(6)),
    totalTokens: totalAgg?.tokens ?? 0,
    topOrgs: topOrgs.map((o) => {
      const org = orgMap.get(String(o._id));
      return {
        orgId: String(o._id),
        name: org?.name ?? "Unknown",
        plan: org?.plan ?? null,
        spentUsd: parseFloat(o.spentUsd.toFixed(6)),
        calls: o.calls,
      };
    }),
  });
});

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
      // Array fields are set wholesale rather than dot-path merging.
      if (group === "plans" || group === "budgetLimits") {
        if (Array.isArray(fields)) $set[group] = fields;
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
