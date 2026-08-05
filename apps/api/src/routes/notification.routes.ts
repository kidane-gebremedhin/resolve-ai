import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { Notification } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { NotFoundError } from "../utils/errors.js";

const router = Router();
router.use(requireAuth, requireOrg);

// GET /notifications — the org's most-recent notifications plus the unread count
// (drives the header bell badge). Org-wide: every member sees the same list and
// shares its read state.
router.get("/", async (req: Request, res: Response) => {
  const organizationId = new mongoose.Types.ObjectId(req.orgId);
  const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50);

  const [items, unreadCount] = await Promise.all([
    Notification.find({ organizationId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Notification.countDocuments({ organizationId, read: false }),
  ]);

  res.json({
    notifications: items.map((n) => ({
      id: String(n._id),
      type: n.type,
      level: n.level,
      title: n.title,
      body: n.body,
      link: n.link,
      agentId: n.agentId ? String(n.agentId) : null,
      websiteId: n.websiteId ? String(n.websiteId) : null,
      read: n.read,
      createdAt: n.createdAt,
    })),
    unreadCount,
  });
});

// POST /notifications/:id/read — mark one org notification read (any member can).
router.post("/:id/read", async (req: Request, res: Response) => {
  const organizationId = new mongoose.Types.ObjectId(req.orgId);
  const updated = await Notification.findOneAndUpdate(
    { _id: req.params.id, organizationId },
    { $set: { read: true, readAt: new Date() } },
    { new: true },
  ).lean();
  if (!updated) throw new NotFoundError("Notification not found");
  res.json({ ok: true });
});

// POST /notifications/read-all — mark every unread org notification read.
router.post("/read-all", async (req: Request, res: Response) => {
  const organizationId = new mongoose.Types.ObjectId(req.orgId);
  await Notification.updateMany(
    { organizationId, read: false },
    { $set: { read: true, readAt: new Date() } },
  );
  res.json({ ok: true });
});

export default router;
