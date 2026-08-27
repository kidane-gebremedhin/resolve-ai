// Platform-admin only routes.
import { Router, type Request, type Response } from "express";
import { sealSecret, openSecret } from "../services/security/secret-field.js";
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
  Website,
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
  const { plan, status, cycle } = req.query as Record<string, string | undefined>;
  const match = mergeFilters(
    searchFilter(params.q, ["paddleSubscriptionId", "paddleCustomerId"]),
    dateRangeFilter("createdAt", params.from, params.to),
    plan && ["pro", "business", "enterprise"].includes(plan) ? { plan } : {},
    status && ["active", "trialing", "past_due", "canceled", "paused"].includes(status) ? { status } : {},
    cycle === "year" ? { billingInterval: "year" } :
    cycle === "month" ? { $or: [{ billingInterval: "month" }, { billingInterval: { $exists: false } }] } :
    {},
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
    // Sealed before storage. An empty string means "leave the stored secret
    // alone" — the GET response never returns it, so the admin UI cannot echo
    // it back and would otherwise wipe it on every unrelated save.
    secret: z.string().max(1024),
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
// Aggregated USD spend grouped by (org, website). Supports period (YYYY-MM),
// custom date range (from/to YYYY-MM-DD), org filter, and website filter.
router.get("/usage/cost", async (req: Request, res: Response) => {
  const {
    period: periodParam,
    from,
    to,
    organizationId,
    websiteId,
  } = req.query as Record<string, string | undefined>;

  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const period = periodParam ?? defaultPeriod;

  // Build the time-range part of the match filter.
  const timeMatch: Record<string, unknown> = {};
  if (from || to) {
    const createdAt: Record<string, Date> = {};
    if (from) createdAt.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setDate(end.getDate() + 1); // inclusive end day
      createdAt.$lt = end;
    }
    timeMatch.createdAt = createdAt;
  } else {
    timeMatch.period = period;
  }

  // Optional entity filters.
  const entityMatch: Record<string, unknown> = {};
  if (organizationId && mongoose.isValidObjectId(organizationId)) {
    entityMatch.organizationId = new mongoose.Types.ObjectId(organizationId);
  }
  if (websiteId && mongoose.isValidObjectId(websiteId)) {
    entityMatch.websiteId = new mongoose.Types.ObjectId(websiteId);
  }

  const match = { ...timeMatch, ...entityMatch };

  // Totals across the whole filter scope.
  const [totalAgg] = await UsageRecord.aggregate<{ total: number; tokens: number }>([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$costUsd" }, tokens: { $sum: "$totalTokens" } } },
  ]);

  // Group by (org, website) pair so the table shows one row per website.
  const rows = await UsageRecord.aggregate<{
    _id: { orgId: unknown; websiteId: unknown };
    spentUsd: number;
    calls: number;
    tokens: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: { orgId: "$organizationId", websiteId: "$websiteId" },
        spentUsd: { $sum: "$costUsd" },
        calls: { $sum: 1 },
        tokens: { $sum: "$totalTokens" },
      },
    },
    { $sort: { spentUsd: -1 } },
    { $limit: 50 },
  ]);

  // Resolve org and website names from the aggregated IDs.
  const orgIds = [...new Set(rows.map((r) => r._id.orgId).filter(Boolean))];
  const websiteIds = [...new Set(rows.map((r) => r._id.websiteId).filter(Boolean))];

  const [orgs, websites] = await Promise.all([
    Organization.find({ _id: { $in: orgIds } }).select("name plan").lean(),
    websiteIds.length
      ? Website.find({ _id: { $in: websiteIds } }).select("name domain organizationId").lean()
      : Promise.resolve([]),
  ]);

  const orgMap = new Map(orgs.map((o) => [String(o._id), o]));
  const siteMap = new Map(websites.map((w) => [String(w._id), w]));

  res.json({
    period: from || to ? undefined : period,
    from: from ?? undefined,
    to: to ?? undefined,
    totalCostUsd: parseFloat((totalAgg?.total ?? 0).toFixed(6)),
    totalTokens: totalAgg?.tokens ?? 0,
    rows: rows.map((r) => {
      const org = orgMap.get(String(r._id.orgId));
      const site = r._id.websiteId ? siteMap.get(String(r._id.websiteId)) : undefined;
      return {
        orgId: String(r._id.orgId),
        orgName: org?.name ?? "Unknown",
        plan: org?.plan ?? null,
        websiteId: r._id.websiteId ? String(r._id.websiteId) : null,
        websiteName: site?.name ?? null,
        websiteDomain: site?.domain ?? null,
        spentUsd: parseFloat(r.spentUsd.toFixed(6)),
        calls: r.calls,
        tokens: r.tokens,
      };
    }),
  });
});

// Lightweight website list for filter dropdowns. Optionally scoped to one org.
router.get("/usage/websites", async (req: Request, res: Response) => {
  const { organizationId } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {};
  if (organizationId && mongoose.isValidObjectId(organizationId)) {
    filter.organizationId = new mongoose.Types.ObjectId(organizationId);
  }
  const sites = await Website.find(filter).select("name domain organizationId").limit(200).lean();
  res.json({ items: sites.map((w) => ({ _id: String(w._id), name: w.name, domain: w.domain })) });
});

router.get("/settings", async (_req: Request, res: Response) => {
  const settings = await loadOrInitSettings();
  // Never send the SMTP password back to the browser — not even to the admin
  // who set it. `smtpSecretSet` is enough for the UI to show that one is saved.
  const plain = (settings as unknown as { toObject?: () => Record<string, unknown> }).toObject
    ? (settings as unknown as { toObject: () => Record<string, unknown> }).toObject()
    : ({ ...(settings as unknown as Record<string, unknown>) });
  const smtp = plain.smtp as Record<string, unknown> | undefined;
  const smtpSecretSet = Boolean(smtp?.secret);
  if (smtp) plain.smtp = { ...smtp, secret: "" };
  res.json({ ...plain, smtpSecretSet });
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
        if (group === "smtp" && key === "secret") {
          // Empty = "unchanged" (see the schema comment). Anything else is a
          // new password and is sealed before it touches the database.
          if (typeof value !== "string" || value === "") continue;
          $set[`${group}.${key}`] = sealSecret(value);
          continue;
        }
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
    const plain = settings.toObject() as Record<string, unknown>;
    const smtp = plain.smtp as Record<string, unknown> | undefined;
    const smtpSecretSet = Boolean(smtp?.secret);
    if (smtp) plain.smtp = { ...smtp, secret: "" };
    res.json({ ...plain, smtpSecretSet });
  },
);

export default router;
