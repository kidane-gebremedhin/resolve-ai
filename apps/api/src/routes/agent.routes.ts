import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Agent, Website } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { env } from "../config/env.js";

const router = Router();
router.use(requireAuth, requireOrg);

// The effective model-tuning defaults (from env). An agent's own fields override
// these at runtime (agent.model ?? env.ai.model, etc.); the dashboard reads this
// so /app/ai and /app/widget prepopulate with what's ACTUALLY in effect when a
// field is unset, instead of guessing a hardcoded default. Must be registered
// before `GET /:id` so "defaults" isn't parsed as an agent id.
router.get("/defaults", (_req: Request, res: Response) => {
  res.json({
    model: env.ai.model,
    temperature: env.ai.temperature,
    confidenceThreshold: env.ai.confidenceThreshold,
  });
});

const agentSchema = z.object({
  // Agents are per-website. `websiteId` is required on create (one agent per
  // website); it cannot be changed via PATCH (stripped below).
  websiteId: z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char id"),
  name: z.string().min(1),
  description: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  welcomeMessage: z.string().optional(),
  suggestedQuestions: z.array(z.string()).default([]),
  systemPromptOverride: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  isActive: z.boolean().default(true),
});

router.get("/", async (req: Request, res: Response) => {
  // Optional ?websiteId= filter — the dashboard fetches the active website's agent.
  const { websiteId } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = { organizationId: req.orgId };
  if (websiteId) filter.websiteId = websiteId;
  const agents = await Agent.find(filter).sort({ createdAt: -1 });
  res.json(agents);
});

router.post("/", validateBody(agentSchema), async (req: Request, res: Response) => {
  const site = await Website.findOne({ _id: req.body.websiteId, organizationId: req.orgId });
  if (!site) throw new NotFoundError("Website not found for this organization.");
  const existing = await Agent.findOne({ websiteId: site._id });
  if (existing) throw new ConflictError("This website already has an agent.");
  const agent = await Agent.create({ ...req.body, organizationId: req.orgId });
  res.status(201).json(agent);
});

router.get("/:id", async (req: Request, res: Response) => {
  const agent = await Agent.findOne({ _id: req.params.id, organizationId: req.orgId });
  if (!agent) throw new NotFoundError("Agent not found.");
  res.json(agent);
});

router.patch("/:id", validateBody(agentSchema.partial()), async (req: Request, res: Response) => {
  // Never move an agent between websites via PATCH.
  const { websiteId: _ignore, ...update } = req.body as Record<string, unknown>;
  const agent = await Agent.findOneAndUpdate(
    { _id: req.params.id, organizationId: req.orgId },
    update,
    { new: true },
  );
  if (!agent) throw new NotFoundError("Agent not found.");
  res.json(agent);
});

router.delete("/:id", async (req: Request, res: Response) => {
  const result = await Agent.findOneAndDelete({ _id: req.params.id, organizationId: req.orgId });
  if (!result) throw new NotFoundError("Agent not found.");
  res.status(204).send();
});

export default router;
