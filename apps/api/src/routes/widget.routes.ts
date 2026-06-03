// Public widget endpoints — consumed by the embed/widget app.
// These do NOT require operator auth; they validate via the contact session token (Phase 2).
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import multer from "multer";
import { getStorage } from "../config/storage.js";
import {
  ContactSession,
  Website,
  Agent,
  WidgetSettings,
  Section,
  Conversation,
  Message,
} from "../models/index.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { requireWidgetSession } from "../middleware/widget-auth.middleware.js";
import { enforceMessageQuota } from "../middleware/plan-limit.middleware.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import { env } from "../config/env.js";
import { generateAiReply } from "../services/ai/agent.service.js";
import { parseFile } from "../services/kb/parsers.js";
import geoip from "geoip-lite";
import { logger } from "../config/logger.js";

// Resolve the visitor's ISO country to default the phone-input country code.
// Public IPs use the offline geoip-lite DB (fast, no network). For local/private
// IPs (e.g. localhost dev) geoip can't resolve, so we fall back to an external
// lookup that uses the SERVER's public IP — which on localhost is the developer's
// own location. The local result is cached for the process.
function isPrivateOrLocal(ip: string): boolean {
  return (
    !ip ||
    ip === "127.0.0.1" ||
    ip === "::1" ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^fc00:/i.test(ip) ||
    /^fe80:/i.test(ip)
  );
}

let cachedLocalCountry: string | null | undefined; // undefined = not yet looked up

async function resolveCountry(ip?: string): Promise<string | undefined> {
  const clean = (ip ?? "").replace(/^::ffff:/, "");
  const local = isPrivateOrLocal(clean);

  if (!local) {
    try {
      const c = geoip.lookup(clean)?.country;
      if (c) return c;
    } catch {
      /* fall through to external lookup */
    }
  } else if (cachedLocalCountry !== undefined) {
    return cachedLocalCountry ?? undefined;
  }

  // External fallback. For local IPs omit the IP so the service uses the
  // server's public IP (the dev's location). Best-effort, short timeout.
  try {
    const target = local ? "" : clean;
    const res = await fetch(`http://ip-api.com/json/${target}?fields=status,countryCode`, {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const j = (await res.json()) as { status?: string; countryCode?: string };
      const code = j.status === "success" && j.countryCode ? j.countryCode : undefined;
      if (local) cachedLocalCountry = code ?? null;
      return code;
    }
  } catch {
    /* ignore — country stays undefined */
  }
  if (local) cachedLocalCountry = null;
  return undefined;
}

const router = Router();

// Small wrapper so async errors propagate to the Express error handler under Express 4.
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---------- POST /widget/init ----------
// Creates a fresh contact session. Returns agent/settings/sections so the
// widget can render its first paint without an extra round-trip.
//
// Org resolution accepts EITHER `agentId` (preferred — used by the dashboard
// preview and the embed snippet) or `domain`. Resolving by `agentId` ties the
// session to that agent's organization directly, so the widget always uses that
// org's knowledge base and its conversations land in that org's inbox —
// regardless of which page the widget is embedded/previewed on.
const initSchema = z
  .object({
    domain: z.string().min(1).optional(),
    agentId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "agentId must be a 24-char hex id")
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Boolean(d.domain) || Boolean(d.agentId), {
    message: "Provide either `agentId` or `domain`.",
  });

type WidgetContext = {
  organizationId: string;
  agent: InstanceType<typeof Agent>;
  website: InstanceType<typeof Website>;
  settings: Awaited<ReturnType<typeof WidgetSettings.findOne>>;
  sections: Awaited<ReturnType<typeof Section.find>>;
};

// Resolve the (agent, org, website, settings, sections) tuple a widget session
// needs. `agentId` wins over `domain` when both are supplied. A website is still
// required because ContactSession/Conversation pin `websiteId`; when resolving
// by agentId we use the org's first active website.
async function resolveWidgetContext(args: {
  domain?: string;
  agentId?: string;
}): Promise<WidgetContext> {
  let agent: InstanceType<typeof Agent> | null = null;
  let website: InstanceType<typeof Website> | null = null;

  if (args.agentId) {
    // Agents are per-website: the agent pins its own website.
    agent = await Agent.findOne({ _id: args.agentId, isActive: true });
    if (!agent) throw new NotFoundError("No active agent for this id.");
    website = await Website.findOne({ _id: agent.websiteId, isActive: true });
    if (!website) {
      throw new NotFoundError("This agent's website is not configured / inactive.");
    }
  } else {
    const domain = (args.domain ?? "").toLowerCase();
    website = await Website.findOne({ domain, isActive: true });
    if (!website) throw new NotFoundError("No active widget for this domain.");
    agent = await Agent.findOne({ websiteId: website._id, isActive: true });
    if (!agent) throw new NotFoundError("No active agent for this website.");
  }

  const organizationId = website.organizationId.toString();
  const [settings, sections] = await Promise.all([
    WidgetSettings.findOne({ organizationId: website.organizationId, agentId: agent._id }),
    Section.find({
      organizationId: website.organizationId,
      agentId: agent._id,
      isActive: true,
    }).sort({ order: 1 }),
  ]);

  return { organizationId, agent, website, settings, sections };
}

async function createWidgetSession(
  ctx: WidgetContext,
  req: Request,
): Promise<{ sessionId: string; sessionToken: string; expiresAt: Date }> {
  const ttlMs = env.sessionTokenExpiryHours * 60 * 60 * 1000;
  const token = crypto.randomUUID();
  const session = await ContactSession.create({
    organizationId: ctx.website.organizationId,
    websiteId: ctx.website._id,
    token,
    metadata: req.body.metadata,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    expiresAt: new Date(Date.now() + ttlMs),
    lastActiveAt: new Date(),
  });
  return {
    sessionId: session._id.toString(),
    sessionToken: token,
    expiresAt: session.expiresAt as Date,
  };
}

function widgetInitPayload(
  ctx: WidgetContext,
  session: { sessionId: string; sessionToken: string; expiresAt: Date },
) {
  return {
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
    agent: {
      id: ctx.agent._id.toString(),
      name: ctx.agent.name,
      avatarUrl: ctx.agent.avatarUrl,
      welcomeMessage: ctx.agent.welcomeMessage,
      suggestedQuestions: ctx.agent.suggestedQuestions,
    },
    settings: ctx.settings,
    sections: ctx.sections,
  };
}

router.post(
  "/init",
  validateBody(initSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await resolveWidgetContext({
      domain: req.body.domain as string | undefined,
      agentId: req.body.agentId as string | undefined,
    });
    const session = await createWidgetSession(ctx, req);
    res.json({ ...widgetInitPayload(ctx, session), countryCode: await resolveCountry(req.ip) });
  }),
);

// ---------- GET /widget/appearance ----------
// Public, unauthenticated, side-effect-free. Returns only cosmetic appearance
// fields resolved by agentId so the embed loader can style the launcher (and
// seed iframe params) BEFORE a session exists — and so operators never need to
// re-copy the embed snippet when they change position/color/theme in the studio.
// Creates NO session (contrast POST /init).
const appearanceQuerySchema = z.object({
  agentId: z.string().regex(/^[0-9a-fA-F]{24}$/, "agentId must be a 24-char hex id"),
});

router.get(
  "/appearance",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = appearanceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("agentId must be a 24-char hex id.");
    }
    const agent = await Agent.findOne({ _id: parsed.data.agentId, isActive: true });
    if (!agent) throw new NotFoundError("No active agent for this id.");

    const settings = await WidgetSettings.findOne({
      organizationId: agent.organizationId,
      agentId: agent._id,
    });

    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      position: settings?.position ?? "bottom-right",
      primaryColor: settings?.primaryColor ?? "#7c3aed",
      theme: settings?.theme ?? "auto",
      launcherIcon: null,
    });
  }),
);

// `POST /widget/sessions` (spec name) is an alias for `/widget/init` — same payload, same response.
// We keep both registered so older clients keep working while spec-aligned clients can call /sessions.
router.post(
  "/sessions",
  validateBody(initSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await resolveWidgetContext({
      domain: req.body.domain as string | undefined,
      agentId: req.body.agentId as string | undefined,
    });
    const session = await createWidgetSession(ctx, req);
    res.status(201).json({ ...widgetInitPayload(ctx, session), countryCode: await resolveCountry(req.ip) });
  }),
);

// ---------- GET /widget/settings ----------
// Returns settings + agent + sections for the current session (no creation, no mutation).
router.get(
  "/settings",
  requireWidgetSession,
  asyncHandler(async (req: Request, res: Response) => {
    const session = await ContactSession.findOne({
      _id: req.contactSessionId,
      organizationId: req.orgId,
    });
    if (!session) throw new NotFoundError("Session not found.");

    // Agents are per-website — resolve the agent for this session's website so
    // the customer keeps seeing the same persona on resume.
    const agent = await Agent.findOne({ websiteId: session.websiteId, isActive: true });
    if (!agent) throw new NotFoundError("No active agent for this website.");

    const [settings, sections] = await Promise.all([
      WidgetSettings.findOne({ organizationId: req.orgId, agentId: agent._id }),
      Section.find({
        organizationId: req.orgId,
        agentId: agent._id,
        isActive: true,
      }).sort({ order: 1 }),
    ]);

    res.json({
      agent: {
        id: agent._id.toString(),
        name: agent.name,
        avatarUrl: agent.avatarUrl,
        welcomeMessage: agent.welcomeMessage,
        suggestedQuestions: agent.suggestedQuestions,
      },
      settings,
      sections,
    });
  }),
);

// ---------- POST /widget/sessions/:id/contact ----------
// Update contact info on the current session. The :id MUST match the authenticated session.
const contactSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(3).max(50).optional(),
  name: z.string().min(1).max(200).optional(),
});

router.post(
  "/sessions/:id/contact",
  requireWidgetSession,
  validateBody(contactSchema),
  asyncHandler(async (req: Request, res: Response) => {
    if (req.params.id !== req.contactSessionId) {
      throw new ValidationError("Session id in path does not match authenticated session.");
    }
    if (!req.body.email && !req.body.phone && !req.body.name) {
      throw new ValidationError("Provide at least one of email, phone, name.");
    }

    const update: Record<string, unknown> = {};
    if (req.body.email) update.email = req.body.email;
    if (req.body.phone) update.phone = req.body.phone;
    if (req.body.name) update.name = req.body.name;

    const session = await ContactSession.findOneAndUpdate(
      { _id: req.contactSessionId, organizationId: req.orgId },
      update,
      { new: true },
    );
    if (!session) throw new NotFoundError("Session not found.");
    res.json({ session });
  }),
);

// ---------- POST /widget/conversations ----------
// Create a new conversation for the current session. If `sectionId` is supplied, we
// pre-fill `subject` from the section's title and (when present) `topicPrompt`.
const createConvoSchema = z.object({
  sectionId: z.string().optional(),
});

router.post(
  "/conversations",
  requireWidgetSession,
  validateBody(createConvoSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = await ContactSession.findOne({
      _id: req.contactSessionId,
      organizationId: req.orgId,
    });
    if (!session) throw new NotFoundError("Session not found.");

    const agent = await Agent.findOne({ websiteId: session.websiteId, isActive: true });
    if (!agent) throw new NotFoundError("No active agent for this website.");

    let subject: string | undefined;
    let metadata: Record<string, unknown> | undefined;
    if (req.body.sectionId) {
      const section = await Section.findOne({
        _id: req.body.sectionId,
        organizationId: req.orgId,
        agentId: agent._id,
        isActive: true,
      });
      if (!section) throw new NotFoundError("Section not found.");
      subject = section.title;
      if (section.topicPrompt) metadata = { topicPrompt: section.topicPrompt };
    }

    const conversation = await Conversation.create({
      threadId: crypto.randomUUID(),
      organizationId: session.organizationId,
      websiteId: session.websiteId,
      agentId: agent._id,
      contactSessionId: session._id,
      status: "active",
      subject,
      metadata,
    });

    res.status(201).json({ conversation });
  }),
);

// ---------- GET /widget/conversations/:id/messages ----------
// Cursor pagination by message _id. Cursor is "messages older than this id".
router.get(
  "/conversations/:id/messages",
  requireWidgetSession,
  asyncHandler(async (req: Request, res: Response) => {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      organizationId: req.orgId,
      contactSessionId: req.contactSessionId,
    });
    if (!conversation) throw new NotFoundError("Conversation not found.");

    const limitRaw = Number((req.query.limit as string) ?? "50");
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 100);
    const cursor = req.query.cursor as string | undefined;

    const filter: Record<string, unknown> = {
      conversationId: conversation._id,
      organizationId: req.orgId,
    };
    if (cursor) {
      // "Older than cursor" — newest-first scan, then we reverse to chronological for the client.
      filter._id = { $lt: cursor };
    }

    // Fetch limit+1 to know whether there's a next page.
    const rows = await Message.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.reverse(); // return chronological (oldest -> newest)
    const nextCursor = hasMore ? String(page[0]?._id ?? "") : null;

    res.json({ items, nextCursor });
  }),
);

// ---------- POST /widget/conversations/:id/messages ----------
// Customer posts a message. We persist immediately, kick off the AI reply in the background,
// and return the user's message. The assistant reply arrives via Socket.io.
const sendMessageSchema = z.object({
  content: z.string().min(1).max(8000),
  attachments: z
    .array(
      z.object({
        fileName: z.string(),
        fileUrl: z.string(),
        url: z.string().optional(),
        mimeType: z.string(),
        size: z.number().int().nonnegative(),
        extractedText: z.string().optional(),
      }),
    )
    .optional(),
});

router.post(
  "/conversations/:id/messages",
  requireWidgetSession,
  enforceMessageQuota,
  validateBody(sendMessageSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      organizationId: req.orgId,
      contactSessionId: req.contactSessionId,
    });
    if (!conversation) throw new NotFoundError("Conversation not found.");

    const message = await Message.create({
      conversationId: conversation._id,
      organizationId: req.orgId,
      role: "customer",
      senderType: "contact",
      senderId: conversation.contactSessionId,
      content: req.body.content,
      attachments: req.body.attachments,
    });

    conversation.lastMessageAt = message.createdAt as Date;
    conversation.lastMessagePreview = (req.body.content as string).slice(0, 140);
    conversation.messageCount = (conversation.messageCount ?? 0) + 1;
    await conversation.save();

    // We need the IO server instance; since `attachSocketServer` doesn't currently expose
    // a getter, we read it from the Express app (Socket.io attaches itself to the http
    // server which shares the app's lifecycle). The handler accepts a typed IoServer, so
    // we pass through the same instance that registerMessageHandlers uses by lazily
    // reading it from `req.app`. TODO: expose `getIO()` from socket/index.ts and use it.
    const io = (req.app.get("io") ?? null) as Parameters<typeof generateAiReply>[2] | null;

    // Always notify the operator dashboard of the customer's message — live, even
    // when the conversation is escalated (a human is handling it and the AI reply
    // path below is skipped). Previously the only `message:new` emit lived inside
    // generateAiReply, so escalated conversations went silent for operators.
    if (io) {
      const payload = {
        conversationId: conversation._id.toString(),
        messageId: message._id.toString(),
      };
      io.to(`org:${conversation.organizationId.toString()}`).emit("message:new", payload);
      io.to(`conversation:${conversation._id.toString()}`).emit("message:new", payload);
    }

    // Fire-and-forget the AI reply (only while active). It emits its own
    // message:new for the AI message once persisted.
    if (conversation.status === "active" && io) {
      generateAiReply(conversation, req.body.content as string, io).catch((err) => {
        logger.error("[widget] AI reply failed", {
          conversationId: conversation._id.toString(),
          err: (err as Error).message,
        });
      });
    }

    res.status(201).json({ message });
  }),
);

// ---------- Attachments ----------
// Storage is delegated to the adapter returned by `getStorage()` (MinIO when
// MINIO_* env vars are configured, local disk otherwise). Object keys are
// tenant-scoped — `org/<orgId>/<sha>.bin` — so future bucket-policy isolation
// can rely on the prefix. We still verify `metadata.organizationId` on every
// download as defence-in-depth.
const ALLOWED_MIME_PREFIXES = ["image/"];
// Widened to match what `parseFile` can extract (PDF/DOCX/Excel/CSV/text/markdown/HTML).
const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// Best-effort text extraction so the AI can read the attachment. Never throws —
// an unreadable/oversized file just yields no text (the upload still succeeds).
async function extractAttachmentText(
  buffer: Buffer,
  mimetype: string,
  filename: string,
): Promise<string | undefined> {
  if (mimetype.startsWith("image/")) return undefined; // no OCR in this bundle
  if (buffer.length > env.attachmentExtractMaxBytes) return "[file too large to read]";
  try {
    const { text } = await parseFile({ buffer, mimetype, filename });
    const trimmed = (text ?? "").trim();
    if (!trimmed) return undefined;
    return trimmed.length > env.attachmentExtractMaxChars
      ? trimmed.slice(0, env.attachmentExtractMaxChars)
      : trimmed;
  } catch (err) {
    logger.warn("[widget] attachment extraction failed", {
      filename,
      mimetype,
      err: (err as Error).message,
    });
    return undefined;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function attachmentKey(orgId: string, sha: string): string {
  return `org/${orgId}/${sha}.bin`;
}

router.post(
  "/conversations/:id/attachments",
  requireWidgetSession,
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw new ValidationError("No file uploaded (field name: 'file').");
    const { buffer, originalname, mimetype, size } = req.file;

    const allowed =
      ALLOWED_MIME_PREFIXES.some((p) => mimetype.startsWith(p)) || ALLOWED_MIME_EXACT.has(mimetype);
    if (!allowed) {
      throw new ValidationError(`MIME type '${mimetype}' is not allowed.`);
    }

    // Ensure the conversation exists and belongs to this session.
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      organizationId: req.orgId,
      contactSessionId: req.contactSessionId,
    });
    if (!conversation) throw new NotFoundError("Conversation not found.");

    const sha = crypto.createHash("sha256").update(buffer).digest("hex");
    const key = attachmentKey(String(req.orgId), sha);

    await getStorage().putObject({
      key,
      buffer,
      contentType: mimetype,
      metadata: {
        fileName: originalname,
        organizationId: String(req.orgId),
        contactSessionId: String(req.contactSessionId),
        conversationId: conversation._id.toString(),
        size: String(size),
        uploadedAt: new Date().toISOString(),
      },
    });

    const extractedText = await extractAttachmentText(buffer, mimetype, originalname);

    // Absolute URL (API origin), so the widget — served from a different origin —
    // resolves it correctly. The caller appends `?t=<sessionToken>` to authenticate
    // the <img>/link request (see requireWidgetSession query-token fallback).
    const fileUrl = `${env.apiBaseUrl}/api/v1/widget/attachments/${sha}`;
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
  }),
);

// Streams a previously uploaded attachment. Requires a valid widget session AND the
// stored object's metadata.organizationId must match the requesting session's org
// (defence-in-depth — the sha alone shouldn't be a capability handed across tenants).
router.get(
  "/attachments/:hash",
  requireWidgetSession,
  asyncHandler(async (req: Request, res: Response) => {
    const shaParam = req.params.hash;
    const sha = Array.isArray(shaParam) ? shaParam[0] : shaParam;
    if (!sha || !/^[a-f0-9]{64}$/i.test(sha)) {
      throw new ValidationError("Invalid attachment hash.");
    }

    const key = attachmentKey(String(req.orgId), sha);
    const obj = await getStorage().getObject(key);
    if (!obj) throw new NotFoundError("Attachment not found.");

    // Cross-tenant guard. MinIO lowercases user-metadata keys on read; the disk
    // adapter preserves the case we wrote. Check both spellings to be safe.
    const meta = obj.metadata ?? {};
    const metaOrg = meta.organizationId ?? meta.organizationid;
    if (!metaOrg || metaOrg !== String(req.orgId)) {
      throw new NotFoundError("Attachment not found.");
    }
    const fileName = meta.fileName ?? meta.filename;

    res.setHeader("Content-Type", obj.contentType ?? "application/octet-stream");
    if (fileName) {
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${fileName.replace(/"/g, "")}"`,
      );
    }
    obj.stream.pipe(res);
  }),
);

export default router;
