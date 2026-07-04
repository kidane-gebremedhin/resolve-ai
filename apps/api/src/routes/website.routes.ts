import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Website } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { enforceWebsiteQuota } from "../middleware/plan-limit.middleware.js";
import { NotFoundError } from "../utils/errors.js";
import { ensureWebsiteAgent } from "../services/agent-provisioning.js";
import { logAuditFromReq } from "../services/audit.service.js";

const router = Router();
router.use(requireAuth, requireOrg);

// A bare hostname: labels of letters/digits/hyphens separated by dots, ending in
// a 2+ letter TLD. No scheme, path, whitespace, or other special characters.
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

const websiteSchema = z.object({
  name: z.string().min(1),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .refine((d) => DOMAIN_RE.test(d), {
      message: "Enter a valid domain like example.com (no http://, paths, or spaces).",
    }),
  allowedOrigins: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

router.get("/", async (req: Request, res: Response) => {
  const websites = await Website.find({ organizationId: req.orgId }).sort({ createdAt: -1 });
  res.json(websites);
});

router.post("/", enforceWebsiteQuota, validateBody(websiteSchema), async (req: Request, res: Response) => {
  const website = await Website.create({ ...req.body, organizationId: req.orgId });
  // Every website gets its own agent (per-website config). Created here so the
  // widget can resolve an agent for the new site immediately. We do NOT seed the
  // name from the website — the agent's identity must be operator-chosen, not the
  // site/brand name (it defaults to a generic "Support agent").
  await ensureWebsiteAgent(req.orgId!, website._id);
  await logAuditFromReq(req, "website.created", String(website._id), { domain: website.domain });
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
  await logAuditFromReq(req, "website.updated", String(website._id), { changes: Object.keys(req.body) });
  res.json(website);
});

router.delete("/:id", async (req: Request, res: Response) => {
  const result = await Website.findOneAndDelete({ _id: req.params.id, organizationId: req.orgId });
  if (!result) throw new NotFoundError("Website not found.");
  await logAuditFromReq(req, "website.deleted", String(req.params.id), { domain: result.domain });
  res.status(204).send();
});

export default router;
