import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { AuditEvent, User } from "../models/index.js";

const router = Router();

// Cursor-paginated audit log. The cursor is opaque to the client (it's the
// `_id` of the last item, sorted desc — Mongo ObjectIds embed a timestamp
// so this gives a stable newest-first cursor without needing a compound
// (createdAt, _id) bookmark).
router.get("/", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const action = typeof req.query.action === "string" ? req.query.action : undefined;
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;

  const query: Record<string, unknown> = { organizationId: req.orgId };
  if (action) query.action = action;
  if (userId && mongoose.Types.ObjectId.isValid(userId)) query.userId = userId;
  if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
    query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const rows = await AuditEvent.find(query)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Hydrate user info (email + name) in a single query to keep the
  // dashboard render simple.
  const userIds = Array.from(
    new Set(page.map((r) => r.userId?.toString()).filter((x): x is string => Boolean(x))),
  );
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select("email name").lean()
    : [];
  const userById = new Map(users.map((u) => [u._id.toString(), u]));

  res.json({
    items: page.map((r) => ({
      _id: r._id,
      action: r.action,
      target: r.target,
      metadata: r.metadata,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt,
      user: r.userId
        ? userById.get(r.userId.toString()) ?? { _id: r.userId, email: null, name: null }
        : null,
    })),
    nextCursor: hasMore ? page[page.length - 1]?._id?.toString() ?? null : null,
  });
});

export default router;
