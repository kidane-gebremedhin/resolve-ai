import { Router, type Request, type Response } from "express";
import type { Server as IoServer } from "socket.io";
import { z } from "zod";
import { Conversation, Message, ContactSession } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { NotFoundError } from "../utils/errors.js";
import { generateSuggestions } from "../services/ai/suggestions.service.js";

const router = Router();
router.use(requireAuth, requireOrg);

function emitConversationUpdated(req: Request, conversationId: string, status: string): void {
  const io = req.app.get("io") as IoServer | undefined;
  if (!io) return;
  io.to(`org:${req.orgId}`).emit("conversation:updated", { conversationId, status });
  io.to(`conversation:${conversationId}`).emit("conversation:updated", {
    conversationId,
    status,
  });
}

router.get("/", async (req: Request, res: Response) => {
  const {
    status,
    websiteId,
    assignedOperatorId,
    limit = "50",
    cursor,
  } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = { organizationId: req.orgId };
  if (status) filter.status = status;
  if (websiteId) filter.websiteId = websiteId;
  if (assignedOperatorId) filter.assignedOperatorId = assignedOperatorId;
  if (cursor) filter._id = { $lt: cursor };

  const cap = Math.min(Number(limit) || 50, 200);
  const items = await Conversation.find(filter)
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(cap + 1)
    .lean();
  const hasMore = items.length > cap;
  const trimmed = hasMore ? items.slice(0, cap) : items;

  // Enrich each conversation with its visitor's IP so the inbox can label rows
  // by IP instead of an opaque "Visitor #<id>".
  const sessionIds = Array.from(
    new Set(trimmed.map((c) => String(c.contactSessionId)).filter(Boolean)),
  );
  const sessions = await ContactSession.find(
    { _id: { $in: sessionIds } },
    { ipAddress: 1 },
  ).lean();
  const ipBySession = new Map(sessions.map((s) => [s._id.toString(), s.ipAddress]));
  const enriched = trimmed.map((c) => ({
    ...c,
    ipAddress: ipBySession.get(String(c.contactSessionId)) ?? null,
  }));

  res.json({
    items: enriched,
    nextCursor: hasMore ? String(trimmed[trimmed.length - 1]!._id) : null,
  });
});

router.get("/:id", async (req: Request, res: Response) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organizationId: req.orgId,
  });
  if (!conversation) throw new NotFoundError("Conversation not found.");
  res.json(conversation);
});

router.get("/:id/messages", async (req: Request, res: Response) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organizationId: req.orgId,
  });
  if (!conversation) throw new NotFoundError("Conversation not found.");

  const { cursor, limit = "50" } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = {
    conversationId: conversation._id,
    organizationId: req.orgId,
  };
  if (cursor) filter._id = { $lt: cursor };

  const cap = Math.min(Number(limit) || 50, 200);
  const found = await Message.find(filter).sort({ _id: -1 }).limit(cap + 1);
  const hasMore = found.length > cap;
  const trimmed = hasMore ? found.slice(0, cap) : found;
  // Return oldest-first (chronological) for renderers.
  const items = [...trimmed].reverse();
  res.json({
    items,
    nextCursor: hasMore ? String(trimmed[trimmed.length - 1]!._id) : null,
  });
});

const patchSchema = z.object({
  status: z.enum(["active", "escalated", "resolved", "expired"]).optional(),
  assignedOperatorId: z.string().nullable().optional(),
  subject: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

router.patch("/:id", validateBody(patchSchema), async (req: Request, res: Response) => {
  const update: Record<string, unknown> = { ...req.body };
  if (req.body.status === "resolved") {
    update.resolvedAt = new Date();
    update.resolvedBy = "operator";
  } else if (req.body.status === "escalated") {
    update.escalatedAt = new Date();
  }
  if (req.body.assignedOperatorId === null) {
    update.assignedOperatorId = undefined;
  }
  const conversation = await Conversation.findOneAndUpdate(
    { _id: req.params.id, organizationId: req.orgId },
    update,
    { new: true },
  );
  if (!conversation) throw new NotFoundError("Conversation not found.");

  if (req.body.status) {
    emitConversationUpdated(req, conversation._id.toString(), conversation.status);
  }
  res.json(conversation);
});

const assignSchema = z.object({
  operatorId: z.string().nullable(),
});

router.patch(
  "/:id/assign",
  validateBody(assignSchema),
  async (req: Request, res: Response) => {
    const update: Record<string, unknown> = {
      assignedOperatorId: req.body.operatorId ?? undefined,
    };
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.orgId },
      update,
      { new: true },
    );
    if (!conversation) throw new NotFoundError("Conversation not found.");

    const io = req.app.get("io") as IoServer | undefined;
    if (io) {
      io.to(`org:${req.orgId}`).emit("conversation:assigned", {
        conversationId: conversation._id.toString(),
        operatorId: conversation.assignedOperatorId?.toString() ?? null,
      });
    }
    res.json(conversation);
  },
);

// ---------- GET /:id/suggestions ----------
// Operator-facing quick-reply suggestions. Always returns exactly 3 strings —
// see suggestions.service.ts for the LLM/fallback shape.
router.get("/:id/suggestions", async (req: Request, res: Response) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organizationId: req.orgId,
  });
  if (!conversation) throw new NotFoundError("Conversation not found.");

  const suggestions = await generateSuggestions({
    conversationId: conversation._id.toString(),
    organizationId: req.orgId!,
  });
  res.json({ suggestions });
});

export default router;
