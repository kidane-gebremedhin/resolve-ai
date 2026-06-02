import type { NextFunction, Request, Response } from "express";
import { Organization, Message, KnowledgeSource } from "../models/index.js";
import { ForbiddenError } from "../utils/errors.js";

type Plan = "free" | "starter" | "pro" | "enterprise";

type PlanLimits = {
  messagesPerMonth: number;
  knowledgeSources: number;
  websites: number;
  teamMembers: number;
};

const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { messagesPerMonth: 200, knowledgeSources: 5, websites: 1, teamMembers: 2 },
  starter: { messagesPerMonth: 2_000, knowledgeSources: 25, websites: 3, teamMembers: 5 },
  pro: { messagesPerMonth: 20_000, knowledgeSources: 200, websites: 10, teamMembers: 25 },
  enterprise: {
    messagesPerMonth: Number.POSITIVE_INFINITY,
    knowledgeSources: Number.POSITIVE_INFINITY,
    websites: Number.POSITIVE_INFINITY,
    teamMembers: Number.POSITIVE_INFINITY,
  },
};

export function limitsForPlan(plan: string | undefined): PlanLimits {
  const key = (plan ?? "free") as Plan;
  return PLAN_LIMITS[key] ?? PLAN_LIMITS.free;
}

async function planFor(orgId: string): Promise<Plan> {
  const org = await Organization.findById(orgId).select("plan").lean();
  return ((org?.plan ?? "free") as Plan) || "free";
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

export function requirePaidPlan(req: Request, _res: Response, next: NextFunction): void {
  // Server-side helper for endpoints gated to non-free plans (e.g., Firecrawl).
  Organization.findById(req.orgId)
    .select("plan")
    .lean()
    .then((org) => {
      if (!org || (org.plan ?? "free") === "free") {
        throw new ForbiddenError("This feature requires a paid plan.");
      }
      next();
    })
    .catch(next);
}
