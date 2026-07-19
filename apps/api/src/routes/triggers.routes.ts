import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { ProactiveTrigger } from "../models/index.js";
import { validateBody } from "../middleware/validation.middleware.js";

const router = Router();

const conditionSchema = z.object({
  type: z.enum(["time_on_page", "scroll_depth", "exit_intent", "url_match", "element_hover"]),
  params: z.record(z.unknown()).default({}),
});

const triggerBodySchema = z.object({
  agentId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  name: z.string().min(1).max(120),
  isActive: z.boolean().optional(),
  conditions: z.array(conditionSchema).min(1),
  conditionLogic: z.enum(["AND", "OR"]).default("AND"),
  message: z.string().min(1).max(2000),
  delayMs: z.number().int().min(0).default(0),
  cooldownMs: z.number().int().min(0).default(86_400_000),
  maxFires: z.number().int().min(1).default(1),
});

const triggerPatchSchema = triggerBodySchema.partial().omit({ agentId: true });

// GET /triggers?agentId=
router.get("/", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const orgId = req.orgId;
  const agentId = req.query.agentId as string | undefined;
  const filter: Record<string, unknown> = { organizationId: orgId };
  if (agentId) filter.agentId = agentId;
  const triggers = await ProactiveTrigger.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ triggers });
});

// POST /triggers
router.post("/", requireAuth, requireOrg, validateBody(triggerBodySchema), async (req: Request, res: Response) => {
  const orgId = req.orgId;
  const trigger = await ProactiveTrigger.create({ ...req.body, organizationId: orgId });
  res.status(201).json({ trigger });
});

// PATCH /triggers/:id
router.patch("/:id", requireAuth, requireOrg, validateBody(triggerPatchSchema), async (req: Request, res: Response) => {
  const orgId = req.orgId;
  const trigger = await ProactiveTrigger.findOneAndUpdate(
    { _id: req.params.id, organizationId: orgId },
    { $set: req.body },
    { new: true },
  );
  if (!trigger) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ trigger });
});

// DELETE /triggers/:id
router.delete("/:id", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const orgId = req.orgId;
  const result = await ProactiveTrigger.deleteOne({ _id: req.params.id, organizationId: orgId });
  if (!result.deletedCount) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

export default router;
