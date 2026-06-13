import type { NextFunction, Request, Response } from "express";
import { Organization, Message, KnowledgeSource, Website, Membership } from "../models/index.js";
import { ForbiddenError } from "../utils/errors.js";
import { limitsForPlan, type Plan } from "../config/plans.js";

export { limitsForPlan };

async function planFor(orgId: string): Promise<string | null> {
  const org = await Organization.findById(orgId).select("plan").lean();
  return (org?.plan as string) || null;
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
  Organization.findById(req.orgId)
    .select("plan")
    .lean()
    .then((org) => {
      if (!org?.plan) {
        throw new ForbiddenError("This feature requires a paid plan.");
      }
      next();
    })
    .catch(next);
}
