// Public, unauthenticated platform endpoints. Only non-sensitive, cosmetic data.
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { PlatformSetting, Agent, ContactMessage } from "../models/index.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { sendMail } from "../services/mailer.service.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const router = Router();

// Demo agent for the marketing pages' embedded widget. Returns the most recently
// created active agent so the marketing site always embeds a LIVE agent — the id
// is resolved dynamically instead of hardcoded, so wiping/recreating data never
// leaves the marketing widget pointing at a dead agent (which 404s /widget/init).
// Only exposes the public agent id (already used as the embed's public key).
router.get("/demo-agent", async (_req: Request, res: Response) => {
  const agent = await Agent.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();
  // Short cache: fresh enough to pick up a re-seed within a minute, cheap enough
  // to not hit the DB on every marketing page view.
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({ agentId: agent ? String(agent._id) : null });
});

// Global app typography, consumed by the web root layout (server-side) so the
// chosen font applies across /app, /admin, and public marketing pages. Cached.
router.get("/theming", async (_req: Request, res: Response) => {
  const s = await PlatformSetting.findOne({ singleton: "global" });
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({
    fontSans: s?.theming?.fontSans ?? "inter",
    fontDisplay: s?.theming?.fontDisplay ?? "inter-tight",
  });
});

// Public marketing "Contact Us" form. Persists the inquiry (so it's never lost)
// and best-effort forwards it to the support inbox. Rate-limited per IP to blunt
// spam/abuse, since it's unauthenticated.
const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  email: z.string().trim().email("Enter a valid email address."),
  message: z.string().trim().min(1, "Message is required.").max(5000),
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 submissions per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many messages. Please try again later." } },
});

router.post("/contact", contactLimiter, validateBody(contactSchema), async (req: Request, res: Response) => {
  const { name, email, message } = req.body as z.infer<typeof contactSchema>;
  const doc = await ContactMessage.create({
    name,
    email,
    message,
    ipAddress: req.ip,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
  });

  // Best-effort notification — never block or fail the request on mail issues.
  if (env.contactInboxEmail) {
    const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
    void sendMail({
      to: env.contactInboxEmail,
      subject: `New contact form message from ${name}`,
      html: `<p><strong>From:</strong> ${esc(name)} &lt;${esc(email)}&gt;</p><p>${esc(message).replace(/\n/g, "<br>")}</p>`,
      text: `From: ${name} <${email}>\n\n${message}`,
    }).catch((err) => logger.error("[contact] notification email failed", { err: (err as Error).message }));
  }

  res.status(201).json({ ok: true, id: String(doc._id) });
});

export default router;
