import { Router, type Request, type Response } from "express";
import type { Server as IoServer } from "socket.io";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { Conversation, Message } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { enforceMessageQuota } from "../middleware/plan-limit.middleware.js";
import { NotFoundError } from "../utils/errors.js";
import { enhanceDraft } from "../services/ai/enhance.service.js";

const router = Router();
router.use(requireAuth, requireOrg);

const createSchema = z.object({
  conversationId: z.string(),
  content: z.string().min(1),
  role: z.enum(["operator", "system"]).default("operator"),
  isEnhanced: z.boolean().optional(),
  originalContent: z.string().optional(),
});

router.post("/", enforceMessageQuota, validateBody(createSchema), async (req: Request, res: Response) => {
  const conversation = await Conversation.findOne({
    _id: req.body.conversationId,
    organizationId: req.orgId,
  });
  if (!conversation) throw new NotFoundError("Conversation not found.");

  const message = await Message.create({
    conversationId: conversation._id,
    organizationId: req.orgId,
    role: req.body.role,
    senderType: req.body.role === "system" ? "system" : "user",
    senderId: req.auth!.userId,
    content: req.body.content,
    isEnhanced: req.body.isEnhanced,
    originalContent: req.body.originalContent,
  });

  conversation.lastMessageAt = message.createdAt as Date;
  conversation.lastMessagePreview = req.body.content.slice(0, 140);
  conversation.messageCount = (conversation.messageCount ?? 0) + 1;
  if (conversation.status === "active") {
    // Operator joining mid-AI conversation flips it to escalated for visibility.
    conversation.status = "escalated";
    conversation.escalatedAt = conversation.escalatedAt ?? new Date();
  }
  await conversation.save();

  const io = req.app.get("io") as IoServer | undefined;
  if (io) {
    const payload = {
      conversationId: conversation._id.toString(),
      messageId: message._id.toString(),
    };
    io.to(`org:${req.orgId}`).emit("message:new", payload);
    io.to(`conversation:${conversation._id.toString()}`).emit("message:new", payload);
    io.to(`contact:${conversation.contactSessionId.toString()}`).emit("message:new", payload);
  }

  res.status(201).json(message);
});

const enhanceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request) => `${req.auth?.userId ?? "anon"}:enhance`,
  message: { error: { code: "rate_limited", message: "Enhance limit: 30/hour per operator." } },
});

const enhanceSchema = z.object({
  draft: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

router.post(
  "/enhance",
  enhanceLimiter,
  validateBody(enhanceSchema),
  async (req: Request, res: Response) => {
    let customerLastMessage: string | undefined;
    if (req.body.conversationId) {
      const convo = await Conversation.findOne({
        _id: req.body.conversationId,
        organizationId: req.orgId,
      });
      if (convo) {
        const last = await Message.findOne({
          conversationId: convo._id,
          role: { $in: ["customer"] },
        })
          .sort({ createdAt: -1 })
          .lean();
        customerLastMessage = last?.content;
      }
    }
    const result = await enhanceDraft({
      draft: req.body.draft,
      customerLastMessage,
    });
    res.json({ enhanced: result.enhanced, original: req.body.draft });
  },
);

export default router;
