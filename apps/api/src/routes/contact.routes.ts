// Contact session CRUD — for the operator-facing leads/CRM view.
import { Router, type Request, type Response } from "express";
import { ContactSession } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { NotFoundError } from "../utils/errors.js";

const router = Router();
router.use(requireAuth, requireOrg);

router.get("/", async (req: Request, res: Response) => {
  const { websiteId, email } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = { organizationId: req.orgId };
  if (websiteId) filter.websiteId = websiteId;
  if (email) filter.email = email.toLowerCase();
  const sessions = await ContactSession.find(filter).sort({ lastActiveAt: -1 }).limit(200);
  res.json(sessions);
});

router.get("/:id", async (req: Request, res: Response) => {
  const session = await ContactSession.findOne({ _id: req.params.id, organizationId: req.orgId });
  if (!session) throw new NotFoundError("Contact session not found.");
  res.json(session);
});

export default router;
