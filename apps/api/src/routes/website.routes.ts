import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Website } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { NotFoundError } from "../utils/errors.js";
import { ensureWebsiteAgent } from "../services/agent-provisioning.js";

const router = Router();
router.use(requireAuth, requireOrg);

const websiteSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  allowedOrigins: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

router.get("/", async (req: Request, res: Response) => {
  const websites = await Website.find({ organizationId: req.orgId }).sort({ createdAt: -1 });
  res.json(websites);
});

router.post("/", validateBody(websiteSchema), async (req: Request, res: Response) => {
  const website = await Website.create({ ...req.body, organizationId: req.orgId });
  // Every website gets its own agent (per-website config). Created here so the
  // widget can resolve an agent for the new site immediately.
  await ensureWebsiteAgent(req.orgId!, website._id, `${website.name} agent`);
  res.status(201).json(website);
});

router.get("/:id", async (req: Request, res: Response) => {
  const website = await Website.findOne({ _id: req.params.id, organizationId: req.orgId });
  if (!website) throw new NotFoundError("Website not found.");
  res.json(website);
});

router.patch("/:id", validateBody(websiteSchema.partial()), async (req: Request, res: Response) => {
  const website = await Website.findOneAndUpdate(
    { _id: req.params.id, organizationId: req.orgId },
    req.body,
    { new: true },
  );
  if (!website) throw new NotFoundError("Website not found.");
  res.json(website);
});

router.delete("/:id", async (req: Request, res: Response) => {
  const result = await Website.findOneAndDelete({ _id: req.params.id, organizationId: req.orgId });
  if (!result) throw new NotFoundError("Website not found.");
  res.status(204).send();
});

export default router;
