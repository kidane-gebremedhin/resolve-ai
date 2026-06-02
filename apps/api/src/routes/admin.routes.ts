// Platform-admin only routes.
import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  Conversation,
  KnowledgeSource,
  Membership,
  Organization,
  PlatformSetting,
  Subscription,
  User,
} from "../models/index.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import {
  adminTimeSeries,
  churnRate30d,
  computeMrr,
  conversationBuckets,
  signupBuckets,
} from "../services/analytics.service.js";

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

const platformSettingsPatchSchema = z
  .object({
    smtp: smtpSchema,
    security: securitySchema,
    limits: limitsSchema,
    branding: brandingSchema,
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
