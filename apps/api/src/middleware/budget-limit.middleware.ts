import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { Organization, ContactSession, UsageRecord } from "../models/index.js";
import { budgetLimitsForPlan } from "../config/plans.js";

function currentPeriod(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${mm}`;
}

async function monthlySpend(filter: Record<string, unknown>, period: string): Promise<number> {
  const [agg] = await UsageRecord.aggregate<{ total: number }>([
    { $match: { ...filter, period } },
    { $group: { _id: null, total: { $sum: "$costUsd" } } },
  ]);
  return agg?.total ?? 0;
}

function budgetExceededResponse(
  res: Response,
  kind: "org" | "website",
  spent: number,
  limit: number,
): Response {
  return res.status(402).json({
    error: {
      code: "budget_limit_exceeded",
      message:
        kind === "org"
          ? "Your organization has reached its monthly AI spending budget."
          : "This website has reached its monthly AI spending budget.",
      kind,
      spentUsd: parseFloat(spent.toFixed(6)),
      limitUsd: limit,
      upgradeUrl: "/app/billing",
    },
  });
}

// Middleware applied to POST /widget/conversations/:id/messages.
// Checks both org-level and website-level USD budgets for the current month.
// Requires req.orgId (set by requireWidgetSession) and req.contactSessionId.
export async function enforceBudgetLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.orgId) return next();

  const org = await Organization.findById(req.orgId).select("plan").lean();
  if (!org?.plan) return next(); // unsubscribed — enforceMessageQuota handles this

  const budgetLimits = await budgetLimitsForPlan(org.plan);
  const period = currentPeriod();
  const orgId = new mongoose.Types.ObjectId(req.orgId);

  // Org-level check
  if (budgetLimits.orgMonthlyLimitUsd > 0) {
    const spent = await monthlySpend({ organizationId: orgId }, period);
    if (spent >= budgetLimits.orgMonthlyLimitUsd) {
      budgetExceededResponse(res, "org", spent, budgetLimits.orgMonthlyLimitUsd);
      return;
    }
  }

  // Website-level check — resolve websiteId from the contact session
  if (budgetLimits.websiteMonthlyLimitUsd > 0 && req.contactSessionId) {
    const session = await ContactSession.findById(req.contactSessionId)
      .select("websiteId")
      .lean();
    if (session?.websiteId) {
      const websiteId = new mongoose.Types.ObjectId(String(session.websiteId));
      const websiteSpent = await monthlySpend({ websiteId }, period);
      if (websiteSpent >= budgetLimits.websiteMonthlyLimitUsd) {
        budgetExceededResponse(res, "website", websiteSpent, budgetLimits.websiteMonthlyLimitUsd);
        return;
      }
    }
  }

  next();
}
