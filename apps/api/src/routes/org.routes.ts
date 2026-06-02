import { Router, type Request, type Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  Organization,
  Membership,
  User,
  Website,
  Agent,
  KnowledgeSource,
  Conversation,
  Message,
  ContactSession,
  WidgetSettings,
  Section,
  Subscription,
  ApiKey,
  AuditEvent,
} from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/errors.js";
import { getPineconeIndex } from "../config/pinecone.js";
import { logger } from "../config/logger.js";

const router = Router();

router.get("/current", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const org = await Organization.findById(req.orgId);
  if (!org) throw new NotFoundError("Organization not found.");
  res.json(org);
});

router.patch("/current", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const allowed = (({ name, settings }) => ({ name, settings }))(req.body ?? {});
  const org = await Organization.findByIdAndUpdate(req.orgId, allowed, { new: true });
  if (!org) throw new NotFoundError("Organization not found.");
  res.json(org);
});

// DELETE /orgs/current — "delete my account": wipes ALL of this organization's
// data (and the org itself). Owner-only and irreversible. Members who belong to
// no other org are deleted too; the caller is then signed out by the client.
router.delete("/current", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const orgId = req.orgId!;
  const me = await Membership.findOne({ organizationId: orgId, userId: req.auth!.userId });
  if (!me || me.role !== "owner") {
    throw new ForbiddenError("Only an organization owner can delete the account.");
  }

  // 1) Purge this org's Pinecone vectors (gathered from every knowledge source).
  try {
    const sources = await KnowledgeSource.find({ organizationId: orgId }, { pineconeIds: 1 }).lean();
    const vectorIds = sources.flatMap((s) => s.pineconeIds ?? []);
    if (vectorIds.length > 0) await getPineconeIndex().deleteMany(vectorIds);
  } catch (err) {
    logger.error("[org] pinecone purge during account delete failed", {
      orgId,
      err: (err as Error).message,
    });
  }

  // 2) Delete every org-scoped collection.
  await Promise.all([
    KnowledgeSource.deleteMany({ organizationId: orgId }),
    Conversation.deleteMany({ organizationId: orgId }),
    Message.deleteMany({ organizationId: orgId }),
    ContactSession.deleteMany({ organizationId: orgId }),
    WidgetSettings.deleteMany({ organizationId: orgId }),
    Section.deleteMany({ organizationId: orgId }),
    Agent.deleteMany({ organizationId: orgId }),
    Website.deleteMany({ organizationId: orgId }),
    Subscription.deleteMany({ organizationId: orgId }),
    ApiKey.deleteMany({ organizationId: orgId }),
    AuditEvent.deleteMany({ organizationId: orgId }),
  ]);

  // 3) Remove memberships, then delete any user left without an org.
  const members = await Membership.find({ organizationId: orgId }, { userId: 1 }).lean();
  await Membership.deleteMany({ organizationId: orgId });
  for (const m of members) {
    const stillMember = await Membership.findOne({ userId: m.userId });
    if (!stillMember) await User.deleteOne({ _id: m.userId });
  }

  // 4) Finally the organization itself.
  await Organization.deleteOne({ _id: orgId });

  logger.info("[org] account deleted", { orgId, by: req.auth!.userId });
  res.json({ deleted: true });
});

router.get("/current/members", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const memberships = await Membership.find({ organizationId: req.orgId }).lean();
  const userIds = memberships.map((m) => m.userId);
  const users = await User.find({ _id: { $in: userIds } })
    .select("email name avatarUrl")
    .lean();
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  res.json(
    memberships.map((m) => ({
      membershipId: m._id,
      role: m.role,
      status: m.status,
      invitedAt: m.invitedAt,
      acceptedAt: m.acceptedAt,
      user: byId.get(m.userId.toString()) ?? null,
    })),
  );
});

const ROLE_RANK: Record<string, number> = { owner: 4, admin: 3, agent: 2, viewer: 1 };

function assertCanManageMembers(req: Request): void {
  const role = req.auth?.membershipRole;
  if (!role || ROLE_RANK[role] < ROLE_RANK.admin) {
    throw new ForbiddenError("Owner or admin role required.");
  }
}

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "agent", "viewer"]),
});

router.post(
  "/current/members/invite",
  requireAuth,
  requireOrg,
  validateBody(inviteSchema),
  async (req: Request, res: Response) => {
    assertCanManageMembers(req);
    const email = String(req.body.email).toLowerCase().trim();

    let user = await User.findOne({ email });
    let isNewUser = false;
    if (!user) {
      user = await User.create({
        email,
        name: req.body.name ?? email.split("@")[0],
        provider: "credentials",
        passwordHash: await bcrypt.hash(`invite-${Date.now()}-${Math.random()}`, 4),
        role: "user",
      });
      isNewUser = true;
    }

    const existing = await Membership.findOne({
      userId: user._id,
      organizationId: req.orgId,
    });
    if (existing && existing.status !== "revoked") {
      throw new ConflictError("User is already a member of this organization.");
    }

    const membership = existing
      ? await Membership.findOneAndUpdate(
          { _id: existing._id },
          {
            role: req.body.role,
            status: "pending",
            invitedBy: req.auth!.userId,
            invitedAt: new Date(),
            acceptedAt: undefined,
          },
          { new: true },
        )
      : await Membership.create({
          userId: user._id,
          organizationId: req.orgId,
          role: req.body.role,
          status: "pending",
          invitedBy: req.auth!.userId,
          invitedAt: new Date(),
        });

    res.status(201).json({
      membershipId: membership!._id,
      role: membership!.role,
      status: membership!.status,
      user: { id: user._id, email: user.email, name: user.name },
      isNewUser,
    });
  },
);

const updateRoleSchema = z.object({
  role: z.enum(["owner", "admin", "agent", "viewer"]).optional(),
  status: z.enum(["active", "pending", "revoked"]).optional(),
});

router.patch(
  "/current/members/:membershipId",
  requireAuth,
  requireOrg,
  validateBody(updateRoleSchema),
  async (req: Request, res: Response) => {
    assertCanManageMembers(req);
    const membership = await Membership.findOne({
      _id: req.params.membershipId,
      organizationId: req.orgId,
    });
    if (!membership) throw new NotFoundError("Membership not found.");

    if (req.body.role === "owner" && req.auth?.membershipRole !== "owner") {
      throw new ForbiddenError("Only an owner can promote another member to owner.");
    }
    if (req.body.role) membership.role = req.body.role;
    if (req.body.status) {
      membership.status = req.body.status;
      if (req.body.status === "active" && !membership.acceptedAt) {
        membership.acceptedAt = new Date();
      }
    }
    await membership.save();
    res.json(membership);
  },
);

router.delete(
  "/current/members/:membershipId",
  requireAuth,
  requireOrg,
  async (req: Request, res: Response) => {
    assertCanManageMembers(req);
    const membership = await Membership.findOne({
      _id: req.params.membershipId,
      organizationId: req.orgId,
    });
    if (!membership) throw new NotFoundError("Membership not found.");
    if (membership.role === "owner") {
      const ownerCount = await Membership.countDocuments({
        organizationId: req.orgId,
        role: "owner",
        status: "active",
      });
      if (ownerCount <= 1) {
        throw new ForbiddenError("Cannot remove the last owner.");
      }
    }
    membership.status = "revoked";
    await membership.save();
    res.json({ ok: true });
  },
);

export default router;
