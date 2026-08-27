// Public widget endpoints — consumed by the embed/widget app.
// These do NOT require operator auth; they validate via the contact session token (Phase 2).
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import {
  ContactSession,
  Website,
  Agent,
  WidgetSettings,
  Section,
  Conversation,
  Message,
  MessageFeedback,
  ConversationRating,
  ProactiveTrigger,
} from "../models/index.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { requireWidgetSession } from "../middleware/widget-auth.middleware.js";
import { enforceMessageQuota } from "../middleware/plan-limit.middleware.js";
import { enforceBudgetLimit } from "../middleware/budget-limit.middleware.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import { env } from "../config/env.js";
import { generateAiReply } from "../services/ai/index.js";
import { widgetRateLimit } from "../middleware/widgetRateLimit.js";
import { dispatchToolCall } from "../services/integrations/dispatcher.js";
import Ajv from "ajv";
import {
  attachmentUpload,
  isAllowedAttachmentMime,
  storeAttachment,
  extractAttachmentText,
  streamStoredAttachment,
} from "../services/attachments.service.js";
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
    // Global feature flags for the widget UI. Voice input is OFF unless the
    // operator explicitly enables it via ALLOW_WIDGET_VOICE_INPUT=true.
    features: {
      voiceInput: process.env.ALLOW_WIDGET_VOICE_INPUT === "true",
    },
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
      primaryColor: settings?.primaryColor ?? "#1e40af",
      // Header treatment: lavender/blue pinstripe by default; but if the operator already set a
      // primaryColor before this option existed, keep their solid-accent header.
      headerStyle: settings?.headerStyle ?? (settings?.primaryColor ? "solid" : "pinstripe"),
      theme: settings?.theme ?? "auto",
      launcherIcon: null,
      // Whether the mic / voice-input button is shown (ALLOW_WIDGET_VOICE_INPUT).
      // The embed uses this to decide whether to delegate `microphone` to the iframe:
      // requesting that capability unconditionally makes some browsers show a
      // permission prompt on page load, so we only grant it when voice is enabled.
      voiceInput: process.env.ALLOW_WIDGET_VOICE_INPUT === "true",
    });
  }),
);

// ---------- GET /widget/triggers ----------
// Public, unauthenticated, side-effect-free. Returns active proactive triggers
// for an agent so the embed loader can evaluate conditions client-side.
// Cache-Control: public, max-age=60 so the trigger list is reloaded at most
// once per minute across all visitors (the embed caches the result per page load).
const triggersQuerySchema = z.object({
  agentId: z.string().regex(/^[0-9a-fA-F]{24}$/, "agentId must be a 24-char hex id"),
});

router.get(
  "/triggers",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = triggersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("agentId must be a 24-char hex id.");
    }
    const agent = await Agent.findOne({ _id: parsed.data.agentId, isActive: true }).select("_id organizationId");
    if (!agent) throw new NotFoundError("No active agent for this id.");
    const triggers = await ProactiveTrigger.find({
      agentId: agent._id,
      organizationId: agent.organizationId,
      isActive: true,
    })
      .select("_id conditions conditionLogic message delayMs cooldownMs maxFires")
      .lean();
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ triggers });
  }),
);

// ---------- GET /widget/sections/:id/content ----------
// Public server-side proxy that renders a section's linked page INSIDE the
// widget iframe. Browsers refuse to frame sites that send `X-Frame-Options` or
// CSP `frame-ancestors` (e.g. support.google.com → "Refused to display … in a
// frame"). We fetch the page server-side (those headers don't restrict us),
// strip the framing/security headers helmet set on OUR response, and inject a
// `<base>` so the page's relative assets/links still resolve to the source.
// Only configured section URLs are fetched (no arbitrary-URL proxy) and obvious
// internal/loopback hosts are blocked — limiting SSRF to operator-set help URLs.
const PRIVATE_HOST_RE =
  /^(localhost$|127\.|0\.0\.0\.0$|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fe80:|fc00:|fd)/i;

router.get(
  "/sections/:id/content",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!/^[0-9a-fA-F]{24}$/.test(id)) throw new ValidationError("Invalid section id.");
    const section = await Section.findOne({ _id: id, isActive: true });
    if (!section?.url) throw new NotFoundError("Section content not found.");

    let target: URL;
    try {
      target = new URL(section.url);
    } catch {
      throw new ValidationError("Section URL is invalid.");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new ValidationError("Unsupported URL scheme.");
    }
    if (PRIVATE_HOST_RE.test(target.hostname)) {
      throw new ValidationError("Blocked host.");
    }

    let upstream: Awaited<ReturnType<typeof fetch>>;
    try {
      upstream = await fetch(target.toString(), {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; ChataxisWidget/1.0)",
          accept: "text/html,application/xhtml+xml,*/*",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ValidationError("Could not load the section content.");
    }

    const ctype = upstream.headers.get("content-type") ?? "text/html; charset=utf-8";
    // Strip the headers helmet added so the widget (a different origin) can frame
    // our response and the proxied page's own assets aren't blocked by our CSP.
    res.removeHeader("X-Frame-Options");
    res.removeHeader("Content-Security-Policy");
    res.removeHeader("Cross-Origin-Embedder-Policy");
    res.removeHeader("Cross-Origin-Resource-Policy");
    res.setHeader("Content-Type", ctype);
    res.setHeader("Cache-Control", "public, max-age=300");

    if (/\btext\/html\b/i.test(ctype)) {
      const html = await upstream.text();

      // 1. <base> keeps relative asset URLs pointing at the source origin.
      const baseTag = `<base href="${target.toString().replace(/"/g, "&quot;")}">`;

      // 2. Silence cross-origin history.replaceState/pushState errors thrown by
      //    SPA routers (e.g. Next.js) that try to update the URL to their own
      //    origin while running inside an iframe on a different origin. We patch
      //    History.prototype (not just the instance) so EVERY call path is
      //    covered — including `History.prototype.replaceState.call(history,…)`,
      //    which an instance-only override would miss. This inline script is the
      //    first child of <head>, so it runs before any framework bootstrap.
      const historyPatch =
        `<script>(function(){try{` +
        `var P=window.History&&window.History.prototype;if(!P)return;` +
        `var _r=P.replaceState,_p=P.pushState;` +
        `P.replaceState=function(s,t,u){try{return _r.call(this,s,t,u)}catch(e){}};` +
        `P.pushState=function(s,t,u){try{return _p.call(this,s,t,u)}catch(e){}};` +
        `}catch(e){}})()</script>`;

      // 3. Prevent cross-origin CORS errors for fonts. Because this proxy
      //    serves content under a different origin (back.*) than the source
      //    (chataxis.pro), the browser sends an Origin header when fetching
      //    fonts and blocks them when the source doesn't return
      //    Access-Control-Allow-Origin. We strip <link rel=preload as=font>
      //    prefetch hints (they always fire eagerly and fail loudly) and inject
      //    a high-specificity CSS rule that substitutes system fonts so no
      //    @font-face download is ever triggered.
      const fontOverride =
        `<style>` +
        `*:not(code):not(pre):not(kbd):not(samp){font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif!important}` +
        `code,pre,kbd,samp{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace!important}` +
        `</style>`;

      const stripped = html
        // Remove X-Frame-Options / CSP <meta> equivalents (HTTP headers already gone).
        .replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, "")
        .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
        // Remove font preload hints — they fire before our style override and
        // cause loud CORS errors even though the font is never ultimately used.
        .replace(/<link[^>]+as=["']?font["']?[^>]*\/?>/gi, "");

      const inject = baseTag + historyPatch + fontOverride;
      const out = /<head[^>]*>/i.test(stripped)
        ? stripped.replace(/(<head[^>]*>)/i, `$1${inject}`)
        : `${inject}${stripped}`;
      res.send(out);
    } else {
      res.send(Buffer.from(await upstream.arrayBuffer()));
    }
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
      features: {
        voiceInput: process.env.ALLOW_WIDGET_VOICE_INPUT === "true",
      },
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

    res.json({ items, nextCursor, conversationStatus: conversation.status });
  }),
);

// ---------- POST /widget/conversations/:id/messages ----------
// Customer posts a message. We persist immediately, kick off the AI reply in the background,
// and return the user's message. The assistant reply arrives via Socket.io.
// coerceTypes so inline-form submissions (all values arrive as strings from the
// widget's text inputs) validate against numeric/boolean tool schema fields — and
// are coerced in place to the right JS types before dispatch (e.g. a webhook's
// `quantity: number` or `expedited: boolean`). Without this, a form for a webhook
// with non-string fields fails validation and surfaces "Submission failed".
//
// strict:false so a tool schema using a standard `format` (e.g. book_meeting's
// `startTime` is `format: "date-time"`) doesn't make ajv THROW at compile time
// ("unknown format ... ignored") — we don't register ajv-formats, and an
// unhandled throw here 500s the submit and shows the customer "Submission failed".
const ajv = new Ajv({ coerceTypes: true, strict: false });

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
  // Inline form submission — bypasses the AI tool loop
  formPayload: z.record(z.string(), z.unknown()).optional(),
  toolKey: z.string().optional(),
});

router.post(
  "/conversations/:id/messages",
  requireWidgetSession,
  widgetRateLimit,
  enforceMessageQuota,
  enforceBudgetLimit,
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

    // When an inline-form submission executes a tool below, we pass its result to
    // generateAiReply so the reply PRESENTS that result (with its rich card) and skips
    // the agentic loop — otherwise the model can wander to an unrelated earlier request.
    let presentToolResult: { toolKey: string; result: unknown } | undefined;

    // Inline form submission: validate payload against tool schema, execute the
    // tool ONCE here (with the customer's submitted values), and rewrite the
    // message so the AI presents THIS result instead of re-calling the tool with
    // guessed values (important for non-idempotent tools like booking/refund).
    if (req.body.toolKey && req.body.formPayload && conversation.status === "active") {
      const { ToolDefinition, Agent } = await import("../models/index.js");
      const toolKey = req.body.toolKey as string;
      const formPayload = req.body.formPayload as Record<string, unknown>;
      const toolDef = await ToolDefinition.findOne({
        organizationId: req.orgId,
        key: toolKey,
        isActive: true,
      }).lean();
      if (toolDef?.jsonSchema) {
        // Validate field TYPES only — not `required`. The inline form intentionally
        // collects just the fields the customer must supply; other required inputs
        // (email, eventTypeId/startTime carried as hidden values, org id) are either
        // merged client-side or authoritatively injected by the dispatcher. Enforcing
        // the full `required` list here rejected valid submissions with a generic
        // "Submission failed. Please try again." The dispatcher, guardrails and the
        // provider adapter still enforce real completeness downstream.
        const schema = { ...(toolDef.jsonSchema as Record<string, unknown>) };
        delete (schema as { required?: unknown }).required;
        // Also drop per-property `enum`s: several connections can share this tool key
        // (Paddle + Stripe both expose upgrade/downgrade), and THIS def is an arbitrary
        // match — its plan-name enum would wrongly reject a value the connection that
        // actually executes (via the chain below) accepts. Validate TYPES only; the
        // adapters authoritatively validate values ("Unknown plan …") and a hard error
        // falls through the chain.
        const props = (schema as { properties?: Record<string, unknown> }).properties;
        if (props && typeof props === "object") {
          const loosened: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(props)) {
            if (v && typeof v === "object" && "enum" in (v as Record<string, unknown>)) {
              const { enum: _enum, ...rest } = v as Record<string, unknown>;
              loosened[k] = rest;
            } else {
              loosened[k] = v;
            }
          }
          (schema as { properties?: Record<string, unknown> }).properties = loosened;
        }
        const validate = ajv.compile(schema);
        if (!validate(formPayload)) {
          throw new ValidationError("Form payload failed schema validation.");
        }
      }
      // Same primary→fallback chain the AI tool loop uses. Without it, a form/OTP
      // submission dispatched to whichever connection the dispatcher picked first —
      // e.g. Stripe when the customer's subscription lives in Paddle — and its
      // "no customer found" error surfaced as "the action couldn't be completed",
      // even though the fallback provider would have succeeded.
      const dispatchCtx = {
        organizationId: req.orgId!,
        agentId: conversation.agentId?.toString() ?? "",
        conversationId: conversation._id,
        contactSessionId: req.contactSessionId!,
      };
      const agentDoc = conversation.agentId
        ? await Agent.findById(conversation.agentId).select("toolPriority").lean()
        : null;
      const order = (
        ((agentDoc as { toolPriority?: { key?: string; connectionIds?: unknown[] }[] } | null)?.toolPriority ?? [])
          .find((p) => p.key === toolKey)?.connectionIds ?? []
      ).map((c) => String(c));
      const chainDefs = await ToolDefinition.find({
        organizationId: req.orgId,
        key: toolKey,
        isActive: true,
        ...(conversation.agentId ? { enabledAgentIds: conversation.agentId } : {}),
      })
        .select("connectionId createdAt")
        .lean();
      const rank = (id: string) => {
        const i = order.indexOf(id);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      const chain = chainDefs
        .filter((d) => d.connectionId)
        .sort(
          (a, b) =>
            rank(String(a.connectionId)) - rank(String(b.connectionId)) ||
            new Date((a as { createdAt?: Date }).createdAt ?? 0).getTime() -
              new Date((b as { createdAt?: Date }).createdAt ?? 0).getTime(),
        )
        .map((d) => String(d.connectionId));
      let dispatch = await dispatchToolCall(toolKey, formPayload, dispatchCtx, chain[0] || undefined).catch(() => null);
      for (let i = 1; i < chain.length; i++) {
        const hardError = dispatch !== null && !dispatch.ok && dispatch.status === "error";
        const softMiss = dispatch?.ok === true && (dispatch.result as { found?: boolean } | null)?.found === false;
        if (dispatch !== null && !hardError && !softMiss) break; // success or intentional stop
        dispatch = await dispatchToolCall(toolKey, formPayload, dispatchCtx, chain[i]).catch(() => null);
      }
      // Identity gate hit on a FORM submission (e.g. an OTP-guarded custom webhook or a
      // subscription form). The AI tool loop renders the code-entry block itself, but a
      // form submission bypasses that loop — without this branch the code email went out
      // while the widget showed NO way to enter it (and typing the digits in chat did
      // nothing). Persist a deterministic AI message carrying the OTP block — with this
      // exact toolKey + payload so the post-verify re-run executes the same submission —
      // and skip the LLM reply for this turn.
      if (dispatch && !dispatch.ok && dispatch.status === "otp_pending") {
        let otpToken = "";
        try {
          otpToken = (JSON.parse(dispatch.reason) as { otpToken?: string }).otpToken ?? "";
        } catch {
          /* reason wasn't JSON — fall through to the generic handling below */
        }
        if (otpToken) {
          const otpText = "For your security, we just emailed you a 6-digit verification code. Enter it below to continue.";
          const aiMessage = await Message.create({
            conversationId: conversation._id,
            organizationId: conversation.organizationId,
            role: "ai",
            senderType: "ai",
            content: otpText,
            confidence: 1,
            blocks: [
              {
                type: "otp",
                otpToken,
                toolKey,
                args: formPayload,
                message: "Enter the 6-digit code we emailed you to confirm it's you.",
              },
            ],
          });
          conversation.lastMessageAt = (aiMessage.createdAt as Date | undefined) ?? new Date();
          conversation.lastMessagePreview = otpText.slice(0, 140);
          conversation.messageCount = (conversation.messageCount ?? 0) + 1;
          await conversation.save();
          if (io) {
            const otpPayload = {
              conversationId: conversation._id.toString(),
              messageId: aiMessage._id.toString(),
            };
            io.to(`org:${conversation.organizationId.toString()}`).emit("message:new", otpPayload);
            io.to(`conversation:${conversation._id.toString()}`).emit("message:new", otpPayload);
            io.to(`contact:${conversation.contactSessionId.toString()}`).emit("message:new", otpPayload);
          }
          res.status(201).json({ message });
          return;
        }
      }
      if (dispatch?.ok === false && dispatch.status === "error") {
        throw new ValidationError("Form submission failed: " + dispatch.error);
      }
      // Human-readable summary for the operator inbox + an automated note carrying
      // the result so the AI acknowledges it and does NOT run the tool again.
      const human = Object.entries(formPayload)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(", ");
      const resultStr = dispatch?.ok
        ? JSON.stringify(dispatch.result).slice(0, 600)
        : dispatch?.blocked
          ? `blocked (${dispatch.reason})`
          : "no result";
      const rewritten =
        `Submitted the ${toolDef?.displayName ?? toolKey} form — ${human}.\n\n` +
        `[Automated: the ${toolKey} tool already ran with these exact values. Result: ${resultStr}. ` +
        `Present this result to the customer conversationally; do NOT call ${toolKey} again.]`;
      message.content = rewritten;
      await message.save();
      conversation.lastMessagePreview = `Submitted ${toolDef?.displayName ?? toolKey}`;
      await conversation.save();
      // Present-only mode for the reply: only when the tool actually returned a result
      // (a guardrail block / no-result still goes through the normal reply path).
      if (dispatch?.ok) presentToolResult = { toolKey, result: dispatch.result };
    }

    // Abuse detection — check message content against configured patterns.
    // On match: escalate the conversation, flag the session, skip AI reply.
    const content = req.body.content as string;
    const isAbusive = env.abusePatterns.length > 0 && env.abusePatterns.some((re) => re.test(content));
    if (isAbusive && conversation.status === "active") {
      await Promise.all([
        Conversation.updateOne(
          { _id: conversation._id },
          { status: "escalated", escalatedAt: new Date() },
        ),
        ContactSession.updateOne(
          { _id: req.contactSessionId },
          { abuseSuspected: true },
        ),
      ]);
      if (io) {
        io.to(`org:${conversation.organizationId.toString()}`).emit("conversation:updated", {
          conversationId: conversation._id.toString(),
          status: "escalated",
        });
      }
      res.status(201).json({ message });
      return;
    }

    // Fire-and-forget the AI reply (only while active). It emits its own
    // message:new for the AI message once persisted.
    if (conversation.status === "active" && io) {
      generateAiReply(
        conversation,
        content,
        io,
        req.body.attachments as import("../services/ai/index.js").CurrentAttachment[] | undefined,
        presentToolResult,
      ).catch((err) => {
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
// Storage, MIME allow-list, text extraction, and streaming live in
// attachments.service.ts (shared with the operator inbox upload/serve routes).

router.post(
  "/conversations/:id/attachments",
  requireWidgetSession,
  attachmentUpload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw new ValidationError("No file uploaded (field name: 'file').");
    const { buffer, originalname, mimetype, size } = req.file;

    if (!isAllowedAttachmentMime(mimetype)) {
      throw new ValidationError(`MIME type '${mimetype}' is not allowed.`);
    }

    // Ensure the conversation exists and belongs to this session.
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      organizationId: req.orgId,
      contactSessionId: req.contactSessionId,
    });
    if (!conversation) throw new NotFoundError("Conversation not found.");

    const sha = await storeAttachment({
      buffer,
      mimetype,
      orgId: String(req.orgId),
      metadata: {
        fileName: originalname,
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
    await streamStoredAttachment(res, String(req.orgId), req.params.hash);
  }),
);

// ---------- POST /widget/messages/:messageId/feedback ----------
// Upsert a thumbs-up/down rating for a single AI message.
const feedbackSchema = z.object({
  rating: z.enum(["up", "down"]),
  reason: z.string().max(500).optional(),
});

router.post(
  "/messages/:messageId/feedback",
  requireWidgetSession,
  validateBody(feedbackSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const messageId = String(req.params.messageId);
    if (!/^[0-9a-fA-F]{24}$/.test(messageId)) throw new ValidationError("Invalid messageId.");

    // Confirm the message belongs to a conversation owned by this session's org.
    const message = await Message.findOne({ _id: messageId, organizationId: req.orgId }).lean();
    if (!message) throw new NotFoundError("Message not found.");

    const session = await ContactSession.findOne({ _id: req.contactSessionId }).lean();
    if (!session) throw new NotFoundError("Session not found.");

    await MessageFeedback.findOneAndUpdate(
      { messageId },
      {
        messageId,
        conversationId: message.conversationId,
        organizationId: req.orgId,
        rating: req.body.rating as "up" | "down",
        reason: req.body.reason ?? undefined,
        contactSessionId: req.contactSessionId,
      },
      { upsert: true, new: true },
    );

    res.status(201).json({ ok: true });
  }),
);

// ---------- POST /widget/conversations/:id/csat ----------
// Record a CSAT star rating after resolution.
const csatSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

router.post(
  "/conversations/:id/csat",
  requireWidgetSession,
  validateBody(csatSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      organizationId: req.orgId,
      contactSessionId: req.contactSessionId,
    });
    if (!conversation) throw new NotFoundError("Conversation not found.");
    if (conversation.status !== "resolved") {
      throw new ValidationError("CSAT can only be submitted for resolved conversations.");
    }

    await ConversationRating.findOneAndUpdate(
      { conversationId: conversation._id },
      {
        conversationId: conversation._id,
        organizationId: req.orgId,
        stars: req.body.stars as number,
        comment: req.body.comment ?? undefined,
        resolvedBy: conversation.resolvedBy ?? "ai",
      },
      { upsert: true, new: true },
    );

    res.status(201).json({ ok: true });
  }),
);

// ---------- POST /widget/conversations/:id/proactive ----------
// Triggered by the embed when a ProactiveTrigger fires. Creates the AI's
// opening message directly (no customer turn) and emits it via socket so the
// widget renders it. Also enforces server-side cooldown via ContactSession
// metadata so multi-device / multi-tab users don't get duplicate fires.
router.post(
  "/conversations/:id/proactive",
  requireWidgetSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { triggerId, seedMessage } = req.body as { triggerId?: string; seedMessage?: string };
    if (!triggerId || !seedMessage) {
      res.status(400).json({ error: "triggerId and seedMessage are required." });
      return;
    }

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      organizationId: req.orgId,
      contactSessionId: req.contactSessionId,
    });
    if (!conversation) throw new NotFoundError("Conversation not found.");

    // Server-side cooldown: read ContactSession.metadata.proactiveFires[triggerId].
    const session = await ContactSession.findById(req.contactSessionId).select("metadata");
    const trigger = await ProactiveTrigger.findById(triggerId).select("cooldownMs").lean();
    if (session && trigger) {
      const fires: Record<string, number> = (session.metadata as Record<string, unknown>)?.proactiveFires as Record<string, number> ?? {};
      const lastFire = fires[triggerId];
      if (lastFire && Date.now() - lastFire < (trigger.cooldownMs ?? 86_400_000)) {
        res.status(429).json({ error: "Cooldown active." });
        return;
      }
      // Record the fire time.
      await ContactSession.updateOne(
        { _id: req.contactSessionId },
        { $set: { [`metadata.proactiveFires.${triggerId}`]: Date.now() } },
      );
    }

    // Save the proactive greeting as an AI message.
    const { getIoServer } = await import("../socket/index.js");
    const io = getIoServer();
    const message = await Message.create({
      conversationId: conversation._id,
      organizationId: req.orgId,
      role: "ai",
      senderType: "ai",
      content: seedMessage,
    });
    if (io) {
      const msgPayload = {
        conversationId: conversation._id.toString(),
        messageId: message._id.toString(),
        message: {
          _id: message._id.toString(),
          conversationId: conversation._id.toString(),
          role: "ai",
          content: seedMessage,
          createdAt: (message.createdAt as Date).toISOString(),
        },
      };
      io.to(`org:${req.orgId}`).emit("message:new", msgPayload);
      // Also deliver to the widget's own socket room so the message appears inline.
      io.to(`contact:${conversation.contactSessionId.toString()}`).emit("message:new", msgPayload);
    }
    res.status(201).json({ ok: true });
  }),
);

// ---------- POST /widget/conversations/:id/voice-message ----------
// Accept a WebM/Opus audio blob from the browser mic, transcribe it via
// Whisper, save the transcription as a customer message, and fire-and-forget
// the AI reply. Returns { messageId, transcription } immediately.
router.post(
  "/conversations/:id/voice-message",
  requireWidgetSession,
  attachmentUpload.single("audio"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No audio file — use field name 'audio' (multipart/form-data)." });
      return;
    }

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      organizationId: req.orgId,
      contactSessionId: req.contactSessionId,
    });
    if (!conversation) throw new NotFoundError("Conversation not found.");
    if (conversation.status !== "active") {
      res.status(400).json({ error: "Conversation is not active." });
      return;
    }

    // Transcribe the uploaded audio via STT service.
    const { transcribe } = await import("../services/voice/stt.service.js");
    let transcription: string;
    try {
      transcription = await transcribe(req.file.buffer, req.file.mimetype);
    } catch (err) {
      logger.error("[widget] STT transcription failed", { err: (err as Error).message });
      res.status(502).json({ error: "Transcription failed — check STT_API_KEY configuration." });
      return;
    }

    if (!transcription.trim()) {
      res.status(400).json({ error: "No speech detected in audio." });
      return;
    }

    // Persist transcription as a customer message.
    const message = await Message.create({
      conversationId: conversation._id,
      organizationId: req.orgId,
      role: "customer",
      senderType: "contact",
      senderId: conversation.contactSessionId,
      content: transcription,
    });

    conversation.lastMessageAt = message.createdAt as Date;
    conversation.lastMessagePreview = transcription.slice(0, 140);
    conversation.messageCount = (conversation.messageCount ?? 0) + 1;
    await conversation.save();

    const io = (req.app.get("io") ?? null) as Parameters<typeof generateAiReply>[2] | null;
    if (io) {
      const payload = {
        conversationId: conversation._id.toString(),
        messageId: message._id.toString(),
      };
      io.to(`org:${conversation.organizationId.toString()}`).emit("message:new", payload);
      io.to(`conversation:${conversation._id.toString()}`).emit("message:new", payload);
    }

    // Fire-and-forget the AI text reply (customers hear it via streaming SSE
    // exactly as with typed messages).
    if (io) {
      generateAiReply(conversation, transcription, io).catch((err) => {
        logger.error("[widget] voice-message AI reply failed", {
          conversationId: conversation._id.toString(),
          err: (err as Error).message,
        });
      });
    }

    res.status(201).json({ messageId: message._id.toString(), transcription });
  }),
);

// ---------- POST /widget/verify-otp ----------
// Customer submits the 6-digit OTP to complete identity verification before
// a high-stakes integration tool call proceeds.
router.post(
  "/verify-otp",
  requireWidgetSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { token: otpToken, otp } = req.body as { token?: string; otp?: string };
    if (!otpToken || !otp) {
      res.status(400).json({ error: "token and otp are required." });
      return;
    }

    const sessionToken = req.sessionToken;
    if (!sessionToken) {
      res.status(401).json({ error: "Missing widget session." });
      return;
    }
    const { verifyOtp } = await import("../services/integrations/otpService.js");
    const ok = await verifyOtp(sessionToken, String(otpToken), String(otp));

    if (!ok) {
      res.status(400).json({ error: "Invalid or expired verification code." });
      return;
    }

    res.json({ ok: true });
  }),
);

export default router;
