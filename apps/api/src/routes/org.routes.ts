import { Router, type Request, type Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { MongoRateStore } from "../middleware/rate-limit-store.js";
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
  Connection,
  ConversationRating,
  CouponRedemption,
  ExternalSubscription,
  IngestionEvent,
  KbChunk,
  KnowledgeGap,
  MessageFeedback,
  Notification,
  OAuthAppConfig,
  Payment,
  ProactiveTrigger,
  RagTurnMetric,
  ToolCallLog,
  ToolDefinition,
  UsageRecord,
} from "../models/index.js";
import { getStorage } from "../config/storage.js";
import { requireAuth, requireOrg, revokeUserTokens } from "../middleware/auth.middleware.js";
import { sendMail } from "../services/mailer.service.js";
import { escapeHtml } from "../utils/html.js";
import { strongPassword } from "../utils/password.js";
import { env } from "../config/env.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { requireOrgRole } from "../middleware/org-role.middleware.js";
import { enforceTeamMemberQuota } from "../middleware/plan-limit.middleware.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../utils/errors.js";
import { getPineconeIndex } from "../config/pinecone.js";
import { logger } from "../config/logger.js";
import { logAuditFromReq } from "../services/audit.service.js";

const router = Router();

router.get("/current", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const org = await Organization.findById(req.orgId);
  if (!org) throw new NotFoundError("Organization not found.");
  res.json(org);
});

router.patch("/current", requireAuth, requireOrg, requireOrgRole("admin"), async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: unknown; settings?: unknown };
  const allowed: { name?: string; settings?: Record<string, unknown> } = {};
  if (typeof body.name === "string") allowed.name = body.name;
  if (body.settings && typeof body.settings === "object") {
    const settings = { ...(body.settings as Record<string, unknown>) };
    // Coerce the typed conversation-controls block (escalation toggle +
    // ask-before-resolve) to booleans; both default true.
    const conv = settings.conversation;
    if (conv && typeof conv === "object") {
      const c = conv as Record<string, unknown>;
      settings.conversation = {
        ...c,
        allowHumanEscalation: c.allowHumanEscalation !== false,
        requireResolveConfirmation: c.requireResolveConfirmation !== false,
      };
    }
    // Pagination preference: how many rows per page in this org's lists. Clamp
    // to 1–200; default 10 (see getOrgPageSize in utils/list-query).
    const pag = settings.pagination;
    if (pag && typeof pag === "object") {
      const raw = Number((pag as Record<string, unknown>).pageSize);
      const pageSize = Number.isFinite(raw) ? Math.min(200, Math.max(1, Math.trunc(raw))) : 10;
      settings.pagination = { ...(pag as Record<string, unknown>), pageSize };
    }
    // dataRegion is a read-only stub — ignore any client-supplied value.
    delete settings.dataRegion;
    allowed.settings = settings;
  }
  const org = await Organization.findByIdAndUpdate(req.orgId, allowed, { new: true });
  if (!org) throw new NotFoundError("Organization not found.");
  await logAuditFromReq(req, "org.settings_updated", String(req.orgId), { changes: Object.keys(allowed) });
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

  // 1b) Purge this org's uploaded files. Keys are `org/<orgId>/…` by contract
  // (see services/storage/index.ts), so the prefix IS the tenant. Without this
  // the database and the vector store are erased while every attachment the
  // customer ever uploaded stays on disk, which is not a deletion.
  try {
    const removed = await getStorage().deleteByPrefix(`org/${orgId}/`);
    logger.info("[org] purged stored attachments during account delete", { orgId, removed });
  } catch (err) {
    logger.error("[org] storage purge during account delete failed", {
      orgId,
      err: (err as Error).message,
    });
  }

  // 2) Delete every org-scoped collection.
  //
  // EVERY one. `org-deletion.test.ts` enumerates the models that carry an
  // `organizationId` and fails if one is missing here, because the failure mode
  // is silent: a collection added later simply keeps its data after the customer
  // has been told their account is gone. That is exactly what happened — sixteen
  // collections, including the full text of every knowledge document
  // (`KbChunk`) and encrypted third-party credentials (`Connection`), survived
  // deletion until this list was completed.
  await Promise.all([
    KnowledgeSource.deleteMany({ organizationId: orgId }),
    KbChunk.deleteMany({ organizationId: orgId }),
    KnowledgeGap.deleteMany({ organizationId: orgId }),
    IngestionEvent.deleteMany({ organizationId: orgId }),
    Conversation.deleteMany({ organizationId: orgId }),
    Message.deleteMany({ organizationId: orgId }),
    MessageFeedback.deleteMany({ organizationId: orgId }),
    ConversationRating.deleteMany({ organizationId: orgId }),
    ContactSession.deleteMany({ organizationId: orgId }),
    WidgetSettings.deleteMany({ organizationId: orgId }),
    Section.deleteMany({ organizationId: orgId }),
    Agent.deleteMany({ organizationId: orgId }),
    Website.deleteMany({ organizationId: orgId }),
    ProactiveTrigger.deleteMany({ organizationId: orgId }),
    Notification.deleteMany({ organizationId: orgId }),
    // Integration credentials are encrypted at rest, which is not a reason to
    // keep them after the account they belong to is gone.
    Connection.deleteMany({ organizationId: orgId }),
    ToolDefinition.deleteMany({ organizationId: orgId }),
    OAuthAppConfig.deleteMany({ organizationId: orgId }),
    ToolCallLog.deleteMany({ organizationId: orgId }),
    RagTurnMetric.deleteMany({ organizationId: orgId }),
    // Billing and usage. Deleted per __specs/12 §6.7 ("cascade delete all
    // collections"). If a tax or accounting obligation requires retaining
    // financial records beyond account deletion, that exception has to be
    // written into §6.7 and carved out here deliberately — not left as an
    // accident of which models someone remembered.
    Subscription.deleteMany({ organizationId: orgId }),
    ExternalSubscription.deleteMany({ organizationId: orgId }),
    Payment.deleteMany({ organizationId: orgId }),
    UsageRecord.deleteMany({ organizationId: orgId }),
    CouponRedemption.deleteMany({ organizationId: orgId }),
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
  name: z.string().min(1).max(120).optional(),
  role: z.enum(["admin", "agent", "viewer"]),
});

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function sendInviteEmail(args: {
  to: string;
  token: string;
  orgName: string;
  inviterName: string;
  role: string;
}): Promise<void> {
  const link = `${env.webBaseUrl}/accept-invite?token=${args.token}`;
  await sendMail({
    to: args.to,
    subject: `You've been invited to join ${args.orgName}`,
    html:
      `<p>${escapeHtml(args.inviterName)} invited you to join <strong>${escapeHtml(args.orgName)}</strong> ` +
      `as ${escapeHtml(args.role)}.</p>` +
      `<p><a href="${link}">Accept the invitation</a></p>` +
      `<p>The link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>`,
  });
}

// Inviting creates a PENDING membership plus, for a brand-new email, a
// password-less placeholder user (so the Team tab can list the invite). The
// invitee activates it through the emailed link: POST /orgs/invites/accept.
// Re-inviting a pending member re-sends the email with a fresh token.
router.post(
  "/current/members/invite",
  requireAuth,
  requireOrg,
  enforceTeamMemberQuota,
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
        role: "user",
      });
      isNewUser = true;
    }

    const existing = await Membership.findOne({
      userId: user._id,
      organizationId: req.orgId,
    });
    if (existing && existing.status === "active") {
      throw new ConflictError("User is already a member of this organization.");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const invite = {
      role: req.body.role,
      status: "pending" as const,
      invitedBy: req.auth!.userId,
      invitedAt: new Date(),
      inviteTokenHash: hashInviteToken(token),
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
    };
    const membership = existing
      ? await Membership.findOneAndUpdate(
          { _id: existing._id },
          { $set: invite, $unset: { acceptedAt: 1 } },
          { new: true },
        )
      : await Membership.create({ userId: user._id, organizationId: req.orgId, ...invite });

    const [org, inviter] = await Promise.all([
      Organization.findById(req.orgId).select("name").lean(),
      User.findById(req.auth!.userId).select("name email").lean(),
    ]);
    let emailSent = true;
    try {
      await sendInviteEmail({
        to: email,
        token,
        orgName: org?.name ?? "a workspace",
        inviterName: inviter?.name || inviter?.email || "A teammate",
        role: req.body.role,
      });
    } catch (err) {
      emailSent = false;
      logger.error("[org] invite email failed", { err: (err as Error).message });
    }

    await logAuditFromReq(req, "member.invited", email, { role: req.body.role, isNewUser });
    res.status(201).json({
      membershipId: membership!._id,
      role: membership!.role,
      status: membership!.status,
      user: { id: user._id, email: user.email, name: user.name },
      isNewUser,
      emailSent,
    });
  },
);

// ---- Invite acceptance (public; the emailed token is the credential) --------
const inviteLimiter = rateLimit({
  store: new MongoRateStore("org:invite"),
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many attempts. Please try again later." } },
});

async function findPendingInvite(token: unknown) {
  if (typeof token !== "string" || token.length < 16 || token.length > 200) return null;
  return Membership.findOne({
    inviteTokenHash: hashInviteToken(token),
    status: "pending",
    inviteExpiresAt: { $gt: new Date() },
  });
}

// The invitee must choose a password when the account has none, or when its
// email was never verified (someone else may have registered that address
// first; the emailed token is the first proof of who owns the inbox).
function inviteNeedsPassword(user: {
  passwordHash?: string | null;
  provider?: string | null;
  emailVerifiedAt?: Date | null;
}): boolean {
  if (!user.emailVerifiedAt) return true;
  return user.provider === "credentials" && !user.passwordHash;
}

router.get("/invites/:token", inviteLimiter, async (req: Request, res: Response) => {
  const membership = await findPendingInvite(req.params.token);
  if (!membership) throw new NotFoundError("This invitation is invalid or has expired.");
  const [org, user] = await Promise.all([
    Organization.findById(membership.organizationId).select("name").lean(),
    User.findById(membership.userId),
  ]);
  if (!user) throw new NotFoundError("This invitation is invalid or has expired.");
  res.json({
    organizationName: org?.name ?? "",
    email: user.email,
    role: membership.role,
    needsPassword: inviteNeedsPassword(user),
  });
});

const acceptSchema = z.object({
  token: z.string().min(16).max(200),
  name: z.string().min(1).max(120).optional(),
  password: strongPassword.optional(),
});

router.post("/invites/accept", inviteLimiter, validateBody(acceptSchema), async (req: Request, res: Response) => {
  const membership = await findPendingInvite(req.body.token);
  if (!membership) throw new UnauthorizedError("This invitation is invalid or has expired.");
  const user = await User.findById(membership.userId);
  if (!user) throw new UnauthorizedError("This invitation is invalid or has expired.");

  if (inviteNeedsPassword(user)) {
    if (!req.body.password) throw new ValidationError("Choose a password to finish joining.");
    const hadUnverifiedOwner = !user.emailVerifiedAt && Boolean(user.passwordHash);
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    if (req.body.name) user.name = req.body.name;
    if (hadUnverifiedOwner) {
      // Whoever set up this unverified account is not proven to be the owner:
      // drop their second factor and every session they hold.
      user.totpEnabled = false;
      user.totpSecret = undefined;
      user.recoveryCodes = undefined;
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    }
  }
  user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
  user.lastOrganizationId = membership.organizationId;
  await user.save();

  membership.status = "active";
  membership.acceptedAt = new Date();
  membership.inviteTokenHash = undefined;
  membership.inviteExpiresAt = undefined;
  await membership.save();

  res.json({ ok: true, email: user.email });
});

const updateRoleSchema = z.object({
  role: z.enum(["owner", "admin", "agent", "viewer"]).optional(),
  status: z.enum(["active", "pending", "revoked"]).optional(),
});

// Within-org privilege rules for member changes:
//   - nobody may change a member who ranks at or above them, except an owner
//     acting on another owner;
//   - only an owner may grant the owner role;
//   - the org must keep at least one active owner.
async function assertMemberChangeAllowed(
  req: Request,
  target: { _id: unknown; role: string; status: string },
  next: { role?: string; status?: string },
): Promise<void> {
  const actorRole = req.auth?.membershipRole ?? "";
  const actorRank = ROLE_RANK[actorRole] ?? 0;
  const targetRank = ROLE_RANK[target.role] ?? 0;
  if (targetRank >= actorRank && !(actorRole === "owner" && target.role === "owner")) {
    throw new ForbiddenError("You can't change a member whose role is equal to or above yours.");
  }
  if (next.role === "owner" && actorRole !== "owner") {
    throw new ForbiddenError("Only an owner can promote another member to owner.");
  }
  const losesOwner =
    target.role === "owner" &&
    target.status === "active" &&
    ((next.role !== undefined && next.role !== "owner") ||
      (next.status !== undefined && next.status !== "active"));
  if (losesOwner) {
    const owners = await Membership.countDocuments({
      organizationId: req.orgId,
      role: "owner",
      status: "active",
    });
    if (owners <= 1) throw new ForbiddenError("The organization must keep at least one owner.");
  }
}

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
    await assertMemberChangeAllowed(req, membership, req.body);

    if (req.body.status === "active" && membership.status === "pending") {
      throw new ValidationError("A pending invitation is activated by the invitee accepting it.");
    }
    const changed =
      (req.body.role && req.body.role !== membership.role) ||
      (req.body.status && req.body.status !== membership.status);
    if (req.body.role) membership.role = req.body.role;
    if (req.body.status) membership.status = req.body.status;
    await membership.save();
    // Role and access live in the member's JWT. Revoke it so the change takes
    // effect now rather than when their access token happens to expire.
    if (changed) await revokeUserTokens(membership.userId);
    await logAuditFromReq(req, "member.updated", String(req.params.membershipId), {
      role: req.body.role,
      status: req.body.status,
    });
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
    await assertMemberChangeAllowed(req, membership, { status: "revoked" });
    membership.status = "revoked";
    membership.inviteTokenHash = undefined;
    membership.inviteExpiresAt = undefined;
    await membership.save();
    await revokeUserTokens(membership.userId);
    await logAuditFromReq(req, "member.revoked", String(req.params.membershipId), { role: membership.role });
    res.json({ ok: true });
  },
);

export default router;
