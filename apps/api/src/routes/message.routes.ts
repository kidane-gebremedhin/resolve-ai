import { Router, type Request, type Response } from "express";
import type { Server as IoServer } from "socket.io";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { Conversation, Message } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { enforceMessageQuota } from "../middleware/plan-limit.middleware.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import { enhanceDraft } from "../services/ai/enhance.service.js";
import { env } from "../config/env.js";
import {
  attachmentUpload,
  isAllowedAttachmentMime,
  storeAttachment,
  extractAttachmentText,
  streamStoredAttachment,
} from "../services/attachments.service.js";

const router = Router();
router.use(requireAuth, requireOrg);

const attachmentSchema = z.object({
  fileName: z.string(),
  fileUrl: z.string(),
  url: z.string().optional(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  extractedText: z.string().optional(),
});

const createSchema = z
  .object({
    conversationId: z.string(),
    content: z.string().default(""),
    role: z.enum(["operator", "system"]).default("operator"),
    isEnhanced: z.boolean().optional(),
    originalContent: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
  })
  // A message needs either text or at least one attachment.
  .refine((v) => v.content.trim().length > 0 || (v.attachments?.length ?? 0) > 0, {
    message: "Message must have content or an attachment.",
    path: ["content"],
  });

router.post("/", enforceMessageQuota, validateBody(createSchema), async (req: Request, res: Response) => {
  const conversation = await Conversation.findOne({
    _id: req.body.conversationId,
    organizationId: req.orgId,
  });
  if (!conversation) throw new NotFoundError("Conversation not found.");

  // Attachment-only operator messages fall back to the file names so the bubble
  // (and the conversation preview) still have a label.
  const content: string =
    (req.body.content as string).trim() ||
    (req.body.attachments?.length
      ? req.body.attachments
          .map((a: z.infer<typeof attachmentSchema>) => a.fileName)
          .join(", ")
      : "");

  const message = await Message.create({
    conversationId: conversation._id,
    organizationId: req.orgId,
    role: req.body.role,
    senderType: req.body.role === "system" ? "system" : "user",
    senderId: req.auth!.userId,
    content,
    attachments: req.body.attachments,
    isEnhanced: req.body.isEnhanced,
    originalContent: req.body.originalContent,
  });

  conversation.lastMessageAt = message.createdAt as Date;
  conversation.lastMessagePreview = content.slice(0, 140);
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

// ---------- Operator attachments ----------
// Mirrors the widget upload/serve (see attachments.service.ts) but under
// operator JWT auth. Objects share the same tenant-scoped storage key, so the
// serve route below streams BOTH operator- and customer-uploaded files for the
// org. The dashboard <img>/link can't attach the Bearer header, so it loads
// these through the web app's same-origin proxy (apps/web .../api/attachments).
router.post(
  "/attachments",
  attachmentUpload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) throw new ValidationError("No file uploaded (field name: 'file').");
    const { buffer, originalname, mimetype, size } = req.file;

    if (!isAllowedAttachmentMime(mimetype)) {
      throw new ValidationError(`MIME type '${mimetype}' is not allowed.`);
    }

    // Scope the upload to a conversation the operator's org owns.
    const conversationId = req.body.conversationId as string | undefined;
    if (!conversationId) throw new ValidationError("conversationId is required.");
    const conversation = await Conversation.findOne({
      _id: conversationId,
      organizationId: req.orgId,
    });
    if (!conversation) throw new NotFoundError("Conversation not found.");

    const sha = await storeAttachment({
      buffer,
      mimetype,
      orgId: String(req.orgId),
      metadata: {
        fileName: originalname,
        operatorId: String(req.auth!.userId),
        conversationId: conversation._id.toString(),
        size: String(size),
        uploadedAt: new Date().toISOString(),
      },
    });

    const extractedText = await extractAttachmentText(buffer, mimetype, originalname);
    const fileUrl = `${env.apiBaseUrl}/api/v1/messages/attachments/${sha}`;
    res.status(201).json({
      attachment: {
        url: fileUrl,
        fileUrl,
        fileName: originalname,
        mimeType: mimetype,
        size,
        ...(extractedText ? { extractedText } : {}),
      },
    });
  },
);

router.get("/attachments/:hash", async (req: Request, res: Response) => {
  await streamStoredAttachment(res, String(req.orgId), req.params.hash);
});

export default router;
