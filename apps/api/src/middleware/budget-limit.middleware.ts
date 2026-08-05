import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { Organization, ContactSession, UsageRecord } from "../models/index.js";
import { budgetLimitsForPlan } from "../config/plans.js";
import { orgBudgetStatus, checkAndSendBudgetAlerts } from "../services/budget-alert.service.js";

// Fire the (idempotent, deduped) budget-alert check whenever we BLOCK a request.
// Alerts are normally sent as a side-effect of recording usage, but once an org
// is over budget its widget messages are blocked before any usage is recorded —
// so without this the owner would never be notified that the wall was hit (esp.
// when a limit is set/lowered below existing spend). Fire-and-forget: never delays
// the 402, and BudgetAlert's unique guard means repeated blocks don't re-send.
//
// checkAndSendBudgetAlerts runs several queries, so we throttle per org+website+
// period to avoid a query storm when a busy over-budget site keeps getting blocked
// (the DB-level dedup still prevents duplicate SENDS; this just skips redundant
// checks between throttle windows).
const alertCheckThrottle = new Map<string, number>();
const ALERT_CHECK_THROTTLE_MS = 60_000;

function triggerBudgetAlert(
  organizationId: string,
  websiteId: string | null,
  period: string,
): void {
  const key = `${organizationId}:${websiteId ?? "org"}:${period}`;
  const now = Date.now();
  const last = alertCheckThrottle.get(key) ?? 0;
  if (now - last < ALERT_CHECK_THROTTLE_MS) return;
  alertCheckThrottle.set(key, now);
  void checkAndSendBudgetAlerts({ organizationId, websiteId, period }).catch(() => undefined);
}

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
      triggerBudgetAlert(req.orgId, null, period);
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
        triggerBudgetAlert(req.orgId, String(session.websiteId), period);
        budgetExceededResponse(res, "website", websiteSpent, budgetLimits.websiteMonthlyLimitUsd);
        return;
      }
    }
  }

  next();
}

// Operator/KB-facing budget gate. Blocks internal AI actions (reply suggestions,
// draft enhance, KB embedding jobs) when the ORG is over its monthly budget, so
// spend can't keep climbing after the cap. Requires req.orgId (operator JWT).
// Returns a clear, operator-facing message (unlike the widget path, which shows
// customers a generic error).
export async function enforceOrgBudget(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.orgId) return next();
  const status = await orgBudgetStatus(req.orgId);
  if (status.exceeded) {
    triggerBudgetAlert(req.orgId, null, currentPeriod());
    res.status(402).json({
      error: {
        code: "budget_limit_exceeded",
        message:
          "AI features are paused — your organization has reached its monthly AI spending budget. " +
          "They'll resume next month, or upgrade your plan / raise the limit to continue now.",
        kind: "org",
        spentUsd: parseFloat(status.spent.toFixed(6)),
        limitUsd: status.limit,
        upgradeUrl: "/app/billing",
      },
    });
    return;
  }
  next();
}
