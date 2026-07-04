import { Router, type Request, type Response, type NextFunction } from "express";
import mongoose from "mongoose";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import {
  Conversation,
  ConversationRating,
  KnowledgeGap,
  Message,
  MessageFeedback,
  ToolCallLog,
} from "../models/index.js";

const router = Router();

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
}

// req.orgId comes from the JWT payload as a STRING. Mongoose `.find()` auto-casts
// it to ObjectId, but aggregation-pipeline `$match` does NOT — a string compared
// against an ObjectId-typed field silently matches nothing. Always wrap orgId in
// an ObjectId before using it inside an aggregate $match.
function orgObjectId(req: Request): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(String(req.orgId));
}

// Parse either ?from=YYYY-MM-DD&to=YYYY-MM-DD or ?days=N into a {since, until} range.
function parseDateRange(query: Request["query"], defaultDays = 30): { since: Date; until: Date; days: number } {
  if (typeof query.from === "string" && typeof query.to === "string") {
    const since = new Date(query.from);
    const until = new Date(query.to + "T23:59:59.999Z");
    if (!isNaN(since.getTime()) && !isNaN(until.getTime()) && since <= until) {
      const days = Math.ceil((until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000));
      return { since, until, days };
    }
  }
  const daysRaw = parseInt(String(query.days ?? defaultDays), 10);
  const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : defaultDays, 1), 365);
  return { since: new Date(Date.now() - days * 24 * 60 * 60 * 1000), until: new Date(), days };
}

// GET /analytics/knowledge-gaps
// Returns top unanswered questions ranked by occurrence count.
// Optional: ?agentId=<id>&limit=<1-50>
router.get(
  "/knowledge-gaps",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const limitRaw = parseInt(String(req.query.limit ?? "10"), 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 10, 1), 50);

    const filter: Record<string, unknown> = {
      organizationId: req.orgId,
      status: "open",
    };
    if (
      typeof req.query.agentId === "string" &&
      mongoose.Types.ObjectId.isValid(req.query.agentId)
    ) {
      filter.agentId = new mongoose.Types.ObjectId(req.query.agentId);
    }

    const gaps = await KnowledgeGap.find(filter)
      .sort({ occurrenceCount: -1, updatedAt: -1 })
      .limit(limit)
      .lean();

    res.json({ items: gaps });
  }),
);

// PATCH /analytics/knowledge-gaps/:id — mark a gap as addressed
router.patch(
  "/knowledge-gaps/:id",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const gap = await KnowledgeGap.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.orgId },
      { $set: { status: "addressed" } },
      { new: true },
    );
    if (!gap) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json(gap);
  }),
);

// GET /analytics/feedback
// Returns CSAT (star ratings) and thumbs up/down feedback summary.
// Optional: ?websiteId=<id>&agentId=<id>&days=30
router.get(
  "/feedback",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const { since, until, days } = parseDateRange(req.query, 30);

    const baseConvoFilter: Record<string, unknown> = { organizationId: req.orgId };
    if (
      typeof req.query.websiteId === "string" &&
      mongoose.Types.ObjectId.isValid(req.query.websiteId)
    ) {
      baseConvoFilter.websiteId = new mongoose.Types.ObjectId(req.query.websiteId);
    }
    if (
      typeof req.query.agentId === "string" &&
      mongoose.Types.ObjectId.isValid(req.query.agentId)
    ) {
      baseConvoFilter.agentId = new mongoose.Types.ObjectId(req.query.agentId);
    }

    // Collect conversation IDs matching the optional website/agent filter.
    const filteredConvoIds =
      Object.keys(baseConvoFilter).length > 1
        ? (
            await Conversation.find(baseConvoFilter, { _id: 1 })
              .lean()
              .limit(50000)
          ).map((c) => c._id)
        : null; // null means "no additional filter" — matches all org conversations

    const csatMatch: Record<string, unknown> = {
      organizationId: orgObjectId(req),
      createdAt: { $gte: since, $lte: until },
    };
    if (filteredConvoIds) csatMatch.conversationId = { $in: filteredConvoIds };

    const feedbackMatch: Record<string, unknown> = {
      organizationId: orgObjectId(req),
      createdAt: { $gte: since, $lte: until },
    };
    if (filteredConvoIds) feedbackMatch.conversationId = { $in: filteredConvoIds };

    const [csatAgg, thumbsAgg] = await Promise.all([
      ConversationRating.aggregate([
        { $match: csatMatch },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            avgStars: { $avg: "$stars" },
            dist: {
              $push: "$stars",
            },
          },
        },
        {
          $project: {
            _id: 0,
            total: 1,
            avgStars: { $round: ["$avgStars", 2] },
            dist: 1,
          },
        },
      ]),
      MessageFeedback.aggregate([
        { $match: feedbackMatch },
        {
          $group: {
            _id: "$rating",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const csatSummary = csatAgg[0] ?? { total: 0, avgStars: null, dist: [] };
    // Build star distribution 1–5.
    const starDist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const s of (csatSummary.dist as number[]) ?? []) {
      if (s >= 1 && s <= 5) starDist[s] = (starDist[s] ?? 0) + 1;
    }

    const thumbsUp = thumbsAgg.find((r: { _id: string }) => r._id === "up")?.count ?? 0;
    const thumbsDown = thumbsAgg.find((r: { _id: string }) => r._id === "down")?.count ?? 0;

    res.json({
      csat: {
        total: csatSummary.total as number,
        avgStars: csatSummary.avgStars as number | null,
        distribution: starDist,
      },
      thumbs: {
        up: thumbsUp as number,
        down: thumbsDown as number,
        total: (thumbsUp as number) + (thumbsDown as number),
      },
      days,
    });
  }),
);

// GET /analytics/low-rated-answers
// Returns the most-recent thumbs-down message feedback items with message content.
// Optional: ?websiteId=<id>&days=30&limit=50
router.get(
  "/low-rated-answers",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const { since, until } = parseDateRange(req.query, 30);
    const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);

    const feedbackFilter: Record<string, unknown> = {
      organizationId: req.orgId,
      rating: "down",
      createdAt: { $gte: since, $lte: until },
    };

    // Optional websiteId filter — resolve conversation IDs for that website.
    if (typeof req.query.websiteId === "string" && mongoose.Types.ObjectId.isValid(req.query.websiteId)) {
      const convoIds = (
        await Conversation.find(
          { organizationId: req.orgId, websiteId: new mongoose.Types.ObjectId(req.query.websiteId) },
          { _id: 1 },
        ).lean()
      ).map((c) => c._id);
      feedbackFilter.conversationId = { $in: convoIds };
    }

    const feedbacks = await MessageFeedback.find(feedbackFilter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Enrich with message content.
    const messageIds = feedbacks.map((f) => f.messageId);
    const messages = await Message.find({ _id: { $in: messageIds } }, { content: 1, conversationId: 1 }).lean();
    const msgMap = new Map(messages.map((m) => [String(m._id), m]));

    const items = feedbacks.map((f) => {
      const msg = msgMap.get(String(f.messageId));
      return {
        _id: String(f._id),
        messageId: String(f.messageId),
        conversationId: String(f.conversationId),
        reason: f.reason ?? null,
        createdAt: f.createdAt,
        messageContent: (msg?.content as string | undefined) ?? null,
      };
    });

    res.json({ items });
  }),
);

// GET /analytics/conversations-daily
// Server-side time-series aggregation — no 200-conversation cap.
// Optional: ?days=30&websiteId=<id>&agentId=<id>
router.get(
  "/conversations-daily",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const { since, until, days } = parseDateRange(req.query, 30);

    const matchFilter: Record<string, unknown> = {
      organizationId: orgObjectId(req),
      createdAt: { $gte: since, $lte: until },
    };
    if (
      typeof req.query.websiteId === "string" &&
      mongoose.Types.ObjectId.isValid(req.query.websiteId)
    ) {
      matchFilter.websiteId = new mongoose.Types.ObjectId(req.query.websiteId);
    }
    if (
      typeof req.query.agentId === "string" &&
      mongoose.Types.ObjectId.isValid(req.query.agentId)
    ) {
      matchFilter.agentId = new mongoose.Types.ObjectId(req.query.agentId);
    }

    const agg = await Conversation.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" },
          },
          total: { $sum: 1 },
          resolved: {
            $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] },
          },
          aiResolved: {
            $sum: { $cond: [{ $eq: ["$resolvedBy", "ai"] }, 1, 0] },
          },
          escalated: {
            $sum: { $cond: [{ $eq: ["$status", "escalated"] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Pad to all days in range.
    const today = new Date();
    today.setUTCHours(23, 59, 59, 999);
    const pointMap = new Map<string, (typeof agg)[0]>(
      agg.map((p: { _id: string }) => [p._id, p]),
    );
    const points = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const pt = pointMap.get(dateStr);
      points.push({
        date: dateStr,
        total: pt?.total ?? 0,
        resolved: pt?.resolved ?? 0,
        aiResolved: pt?.aiResolved ?? 0,
        escalated: pt?.escalated ?? 0,
      });
    }

    res.json({ points, days });
  }),
);

// GET /analytics/tool-calls
// Paginated list of AI tool invocations for the org — operator audit trail.
// Optional: ?conversationId=<id>&toolKey=<str>&status=<str>&days=90&limit=50&cursor=<id>
router.get(
  "/tool-calls",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 100);

    const { since, until, days } = parseDateRange(req.query, 90);

    const filter: Record<string, unknown> = {
      organizationId: req.orgId,
      createdAt: { $gte: since, $lte: until },
    };

    if (
      typeof req.query.conversationId === "string" &&
      mongoose.Types.ObjectId.isValid(req.query.conversationId)
    ) {
      filter.conversationId = new mongoose.Types.ObjectId(req.query.conversationId);
    }
    if (typeof req.query.toolKey === "string" && req.query.toolKey) {
      filter.toolKey = req.query.toolKey;
    }
    if (
      typeof req.query.status === "string" &&
      ["success", "guardrail_blocked", "error", "otp_pending"].includes(req.query.status)
    ) {
      filter.status = req.query.status;
    }

    // Cursor-based pagination (by _id descending)
    if (
      typeof req.query.cursor === "string" &&
      mongoose.Types.ObjectId.isValid(req.query.cursor)
    ) {
      filter._id = { $lt: new mongoose.Types.ObjectId(req.query.cursor) };
    }

    const items = await ToolCallLog.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    res.json({
      items,
      nextCursor: hasMore ? String(items[items.length - 1]?._id) : null,
      days,
    });
  }),
);

export default router;
