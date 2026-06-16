import type { NextFunction, Request, Response } from "express";
import { Organization, Subscription, Message, KnowledgeSource, Website, Membership } from "../models/index.js";
import { ForbiddenError } from "../utils/errors.js";
import { limitsForPlan, type Plan } from "../config/plans.js";

export { limitsForPlan };

async function planFor(orgId: string): Promise<string | null> {
  const org = await Organization.findById(orgId).select("plan").lean();
  if (org?.plan) return org.plan as string;
  // Fallback: when org.plan hasn't been mirrored yet (e.g. webhook delay,
  // yearly priceId mapping gap), read directly from an active subscription.
  const sub = await Subscription.findOne({ organizationId: orgId })
    .select("plan status")
    .lean();
  if (sub && (sub.status === "active" || sub.status === "trialing") && sub.plan) {
    return sub.plan as string;
  }
  return null;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function quotaResponse(res: Response, kind: string, used: number, limit: number): Response {
  return res.status(402).json({
    error: {
      code: "plan_limit_exceeded",
      message: `Plan limit for ${kind} reached.`,
      kind,
      used,
      limit,
    },
  });
}

export async function enforceMessageQuota(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.orgId) return next();
  const plan = await planFor(req.orgId);
  const limit = limitsForPlan(plan).messagesPerMonth;
  if (!Number.isFinite(limit)) return next();
  const used = await Message.countDocuments({
    organizationId: req.orgId,
    createdAt: { $gte: startOfMonth() },
  });
  if (used >= limit) {
    quotaResponse(res, "messages", used, limit);
    return;
  }
  next();
}

export async function enforceKnowledgeQuota(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.orgId) return next();
  const plan = await planFor(req.orgId);
  const limit = limitsForPlan(plan).knowledgeSources;
  if (!Number.isFinite(limit)) return next();
  const used = await KnowledgeSource.countDocuments({ organizationId: req.orgId });
  if (used >= limit) {
    quotaResponse(res, "knowledge_sources", used, limit);
    return;
  }
  next();
}

export async function enforceWebsiteQuota(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.orgId) return next();
  const plan = await planFor(req.orgId);
  const limit = limitsForPlan(plan).websites;
  if (!Number.isFinite(limit)) return next();
  const used = await Website.countDocuments({ organizationId: req.orgId });
  if (used >= limit) {
    quotaResponse(res, "websites", used, limit);
    return;
  }
  next();
}

export async function enforceTeamMemberQuota(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.orgId) return next();
  const plan = await planFor(req.orgId);
  const limit = limitsForPlan(plan).teamMembers;
  if (!Number.isFinite(limit)) return next();
  const used = await Membership.countDocuments({
    organizationId: req.orgId,
    status: { $in: ["active", "pending"] },
  });
  if (used >= limit) {
    quotaResponse(res, "team_members", used, limit);
    return;
  }
  next();
}

export function requirePaidPlan(req: Request, _res: Response, next: NextFunction): void {
  planFor(req.orgId!)
    .then((plan) => {
      if (!plan) throw new ForbiddenError("This feature requires a paid plan.");
      next();
    })
    .catch(next);
}
