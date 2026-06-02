import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { ApiKey } from "../models/index.js";
import { generateApiKey } from "../services/api-key.service.js";
import { logAuditFromReq } from "../services/audit.service.js";
import { NotFoundError, ForbiddenError } from "../utils/errors.js";

const router = Router();

// Per-org API keys. Only owners/admins/agents (anyone with org context) can
// list. Create + revoke are restricted to admin+ to mirror the existing
// `assertCanManageMembers` semantics in org.routes — but we keep the check
// inline to avoid cross-route imports.

const ROLE_RANK: Record<string, number> = { owner: 4, admin: 3, agent: 2, viewer: 1 };

function assertCanManageKeys(req: Request): void {
  const role = req.auth?.membershipRole;
  if (!role || ROLE_RANK[role] < ROLE_RANK.admin) {
    throw new ForbiddenError("Owner or admin role required.");
  }
}

router.get("/", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const keys = await ApiKey.find({ organizationId: req.orgId, revokedAt: { $in: [null, undefined] } })
    .sort({ createdAt: -1 })
    .lean();
  res.json(
    keys.map((k) => ({
      _id: k._id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes ?? [],
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
    })),
  );
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(["read", "write"])).optional(),
  expiresAt: z.string().datetime().optional(),
});

router.post(
  "/",
  requireAuth,
  requireOrg,
  validateBody(createSchema),
  async (req: Request, res: Response) => {
    assertCanManageKeys(req);
    const { key, prefix, hash } = generateApiKey();
    const doc = await ApiKey.create({
      organizationId: req.orgId,
      name: req.body.name,
      prefix,
      keyHash: hash,
      scopes: req.body.scopes && req.body.scopes.length > 0 ? req.body.scopes : ["read"],
      createdBy: req.auth!.userId,
      expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
    });

    await logAuditFromReq(req, "api_key.created", doc._id.toString(), {
      name: doc.name,
      scopes: doc.scopes,
    });

    res.status(201).json({
      _id: doc._id,
      name: doc.name,
      prefix: doc.prefix,
      scopes: doc.scopes,
      createdAt: doc.createdAt,
      expiresAt: doc.expiresAt,
      // Plaintext key — shown ONCE. The client must surface this to the
      // user and never store it again on the server side.
      key,
    });
  },
);

router.delete("/:id", requireAuth, requireOrg, async (req: Request, res: Response) => {
  assertCanManageKeys(req);
  const key = await ApiKey.findOne({ _id: req.params.id, organizationId: req.orgId });
  if (!key) throw new NotFoundError("API key not found.");
  if (!key.revokedAt) {
    key.revokedAt = new Date();
    await key.save();
  }
  await logAuditFromReq(req, "api_key.revoked", key._id.toString(), {
    name: key.name,
  });
  res.json({ ok: true });
});

export default router;
