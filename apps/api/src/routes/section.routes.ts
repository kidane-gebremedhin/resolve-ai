// Widget homepage "Sections" — the cards a visitor sees before they start a
// chat (link to a doc, jump into a topic-pinned chat, etc.). One agent owns
// many sections; widget /init returns them sorted by `order`. Per spec 11
// the operator-facing CRUD lives at /sections/:agentId.
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Agent, Section } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { NotFoundError } from "../utils/errors.js";

const router = Router();
router.use(requireAuth, requireOrg);

const sectionCreateSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  icon: z.string().max(80).optional(),
  url: z.string().url().optional(),
  action: z.enum(["link", "start-chat", "topic"]).optional(),
  topicPrompt: z.string().max(2000).optional(),
  order: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const sectionUpdateSchema = sectionCreateSchema.partial();

async function ownedAgent(agentId: string, orgId: string) {
  const agent = await Agent.findOne({ _id: agentId, organizationId: orgId });
  if (!agent) throw new NotFoundError("Agent not found.");
  return agent;
}

router.get("/:agentId", async (req: Request, res: Response) => {
  const agent = await ownedAgent(String(req.params.agentId), req.orgId!);
  const sections = await Section.find({
    organizationId: req.orgId,
    agentId: agent._id,
  }).sort({ order: 1, createdAt: 1 });
  res.json(sections);
});

router.post(
  "/:agentId",
  validateBody(sectionCreateSchema),
  async (req: Request, res: Response) => {
    const agent = await ownedAgent(String(req.params.agentId), req.orgId!);
    const section = await Section.create({
      ...req.body,
      organizationId: req.orgId,
      agentId: agent._id,
    });
    res.status(201).json(section);
  },
);

router.patch(
  "/:id",
  validateBody(sectionUpdateSchema),
  async (req: Request, res: Response) => {
    const section = await Section.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.orgId },
      { $set: req.body },
      { new: true },
    );
    if (!section) throw new NotFoundError("Section not found.");
    res.json(section);
  },
);

router.delete("/:id", async (req: Request, res: Response) => {
  const result = await Section.findOneAndDelete({
    _id: req.params.id,
    organizationId: req.orgId,
  });
  if (!result) throw new NotFoundError("Section not found.");
  res.status(204).send();
});

export default router;
