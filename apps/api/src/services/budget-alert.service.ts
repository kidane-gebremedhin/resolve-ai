import mongoose from "mongoose";
import { Organization, Website, Agent, BudgetAlert, UsageRecord } from "../models/index.js";
import { budgetLimitsForPlan } from "../config/plans.js";
import { sendMail } from "./mailer.service.js";
import { createNotification, orgAdminEmails } from "./notification.service.js";
import { logger } from "../config/logger.js";

type Threshold = 50 | 75 | 100;
const THRESHOLDS: Threshold[] = [50, 75, 100];

// Aggregate current-month USD spend for an org.
export async function monthlyOrgSpend(organizationId: string, period: string): Promise<number> {
  const [agg] = await UsageRecord.aggregate<{ total: number }>([
    { $match: { organizationId: new mongoose.Types.ObjectId(organizationId), period } },
    { $group: { _id: null, total: { $sum: "$costUsd" } } },
  ]);
  return agg?.total ?? 0;
}

// Aggregate current-month USD spend for a specific website.
export async function monthlyWebsiteSpend(websiteId: string, period: string): Promise<number> {
  const [agg] = await UsageRecord.aggregate<{ total: number }>([
    { $match: { websiteId: new mongoose.Types.ObjectId(websiteId), period } },
    { $group: { _id: null, total: { $sum: "$costUsd" } } },
  ]);
  return agg?.total ?? 0;
}

async function alertAlreadySent(
  entityType: "org" | "website",
  entityId: string,
  period: string,
  threshold: Threshold,
): Promise<boolean> {
  const doc = await BudgetAlert.findOne({
    entityType,
    entityId: new mongoose.Types.ObjectId(entityId),
    period,
    threshold,
  }).lean();
  return Boolean(doc);
}

async function markAlertSent(
  entityType: "org" | "website",
  entityId: string,
  period: string,
  threshold: Threshold,
): Promise<void> {
  try {
    await BudgetAlert.create({
      entityType,
      entityId: new mongoose.Types.ObjectId(entityId),
      period,
      threshold,
    });
  } catch {
    // Unique constraint violation = already sent; safe to ignore.
  }
}

function budgetEmailHtml(opts: {
  threshold: Threshold;
  entityLabel: string;
  spent: number;
  limit: number;
  period: string;
  appName: string;
  billingUrl: string;
}): { subject: string; html: string } {
  const { threshold, entityLabel, spent, limit, period, appName, billingUrl } = opts;
  const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
  const isExceeded = threshold === 100;
  const title = isExceeded
    ? `Budget limit reached for ${entityLabel}`
    : `${threshold}% of budget used for ${entityLabel}`;
  const body = isExceeded
    ? `Your <strong>${entityLabel}</strong> has reached its USD budget limit of <strong>$${limit.toFixed(2)}</strong> for ${period}.
       AI responses are now paused until the budget is renewed next month or your plan is upgraded.`
    : `Your <strong>${entityLabel}</strong> has used <strong>$${spent.toFixed(4)}</strong> (${pct}%) of its
       $${limit.toFixed(2)} monthly USD budget for ${period}.`;

  const subject = `[${appName}] ${title}`;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:${isExceeded ? "#dc2626" : "#d97706"};margin-top:0">${title}</h2>
      <p style="color:#374151;line-height:1.6">${body}</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="color:#6b7280;padding:4px 12px 4px 0">Period</td><td style="font-weight:600">${period}</td></tr>
        <tr><td style="color:#6b7280;padding:4px 12px 4px 0">Spent</td><td style="font-weight:600">$${spent.toFixed(4)}</td></tr>
        <tr><td style="color:#6b7280;padding:4px 12px 4px 0">Budget</td><td style="font-weight:600">$${limit.toFixed(2)}</td></tr>
        <tr><td style="color:#6b7280;padding:4px 12px 4px 0">Usage</td><td style="font-weight:600">${pct}%</td></tr>
      </table>
      <p>
        <a href="${billingUrl}" style="background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
          ${isExceeded ? "Upgrade Plan" : "View Usage"}
        </a>
      </p>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">
        This is an automated notification from ${appName}.
      </p>
    </div>`;
  return { subject, html };
}

// Dispatch a single threshold alert: an EMAIL to each org owner/admin AND one
// ORG-WIDE in-app notification, then mark it sent so it never repeats this period.
// Website-level alerts deep-link to the corresponding agent; org-level to billing.
async function dispatchAlert(opts: {
  entityType: "org" | "website";
  entityId: string;
  organizationId: string;
  threshold: Threshold;
  entityLabel: string;
  spent: number;
  limit: number;
  period: string;
  appName: string;
  billingUrl: string;
  emails: string[];
  agentId?: string | null;
  websiteId?: string | null;
}): Promise<void> {
  const alreadySent = await alertAlreadySent(
    opts.entityType,
    opts.entityId,
    opts.period,
    opts.threshold,
  );
  if (alreadySent) return;

  const isExceeded = opts.threshold === 100;
  const pct = opts.limit > 0 ? Math.round((opts.spent / opts.limit) * 100) : 0;

  const { subject, html } = budgetEmailHtml({
    threshold: opts.threshold,
    entityLabel: opts.entityLabel,
    spent: opts.spent,
    limit: opts.limit,
    period: opts.period,
    appName: opts.appName,
    billingUrl: opts.billingUrl,
  });

  // In-app notification copy (shorter than the email).
  const notifTitle = isExceeded
    ? `AI budget reached for ${opts.entityLabel}`
    : `${opts.threshold}% of AI budget used`;
  const notifBody = isExceeded
    ? `Your ${opts.entityLabel} hit its $${opts.limit.toFixed(2)} monthly AI budget. AI responses are paused until next month or a plan upgrade.`
    : `Your ${opts.entityLabel} has used ${pct}% ($${opts.spent.toFixed(2)}) of its $${opts.limit.toFixed(2)} monthly AI budget.`;

  // A website-scoped alert deep-links to that agent (the AI page scopes by
  // website); an org-scoped alert goes to billing.
  const link = opts.agentId ? "/app/ai" : "/app/billing";

  await Promise.all([
    ...opts.emails.map((to) => sendMail({ to, subject, html })),
    createNotification({
      organizationId: opts.organizationId,
      type: isExceeded ? "budget_exceeded" : "budget_warning",
      level: isExceeded ? "error" : "warning",
      title: notifTitle,
      body: notifBody,
      link,
      agentId: opts.agentId ?? null,
      websiteId: opts.websiteId ?? null,
    }),
  ]);

  await markAlertSent(opts.entityType, opts.entityId, opts.period, opts.threshold);
  logger.info("[budget-alert] dispatched", {
    entityType: opts.entityType,
    entityId: opts.entityId,
    period: opts.period,
    threshold: opts.threshold,
  });
}

// Called after every UsageRecord is saved. Computes current spend and sends
// alerts at 50%, 75% and 100% thresholds (each sent at most once per period),
// delivered as BOTH an email and an in-app notification to org owners/admins.
export async function checkAndSendBudgetAlerts(opts: {
  organizationId: string;
  websiteId: string | null;
  period: string;
}): Promise<void> {
  const { organizationId, websiteId, period } = opts;

  const org = await Organization.findById(organizationId).select("plan name").lean();
  if (!org?.plan) return; // unsubscribed — no budget to check

  const budgetLimits = await budgetLimitsForPlan(org.plan);
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? "Platform";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const billingUrl = `${appUrl}/app/billing`;

  const emails = await orgAdminEmails(organizationId);

  // Org-level alerts (in-app notification is org-wide even if there are no admin
  // emails, so we don't gate the whole block on emails.length).
  if (budgetLimits.orgMonthlyLimitUsd > 0) {
    const orgSpent = await monthlyOrgSpend(organizationId, period);
    for (const threshold of THRESHOLDS) {
      const pct = (orgSpent / budgetLimits.orgMonthlyLimitUsd) * 100;
      if (pct >= threshold) {
        await dispatchAlert({
          entityType: "org",
          entityId: organizationId,
          organizationId,
          threshold,
          entityLabel: `organization "${org.name as string}"`,
          spent: orgSpent,
          limit: budgetLimits.orgMonthlyLimitUsd,
          period,
          appName,
          billingUrl,
          emails,
        });
      }
    }
  }

  // Website-level alerts — resolve the website's agent so the notification can
  // deep-link to it (each website maps to exactly one agent).
  if (websiteId && budgetLimits.websiteMonthlyLimitUsd > 0) {
    const websiteSpent = await monthlyWebsiteSpend(websiteId, period);
    const website = await Website.findById(websiteId).select("name").lean();
    const websiteLabel = website?.name ? `website "${website.name as string}"` : "website";
    const agent = await Agent.findOne({ websiteId }).select("_id").lean();

    for (const threshold of THRESHOLDS) {
      const pct = (websiteSpent / budgetLimits.websiteMonthlyLimitUsd) * 100;
      if (pct >= threshold) {
        await dispatchAlert({
          entityType: "website",
          entityId: websiteId,
          organizationId,
          threshold,
          entityLabel: websiteLabel,
          spent: websiteSpent,
          limit: budgetLimits.websiteMonthlyLimitUsd,
          period,
          appName,
          billingUrl,
          emails,
          agentId: agent ? String(agent._id) : null,
          websiteId,
        });
      }
    }
  }
}

// Current-month org budget status — used to GATE operator/KB AI actions when the
// org is over budget (the widget path has its own middleware). Returns exceeded
// = false for unsubscribed orgs and unlimited (0) budgets.
export async function orgBudgetStatus(
  organizationId: string,
): Promise<{ exceeded: boolean; spent: number; limit: number }> {
  const org = await Organization.findById(organizationId).select("plan").lean();
  if (!org?.plan) return { exceeded: false, spent: 0, limit: 0 };

  const budgetLimits = await budgetLimitsForPlan(org.plan);
  const limit = budgetLimits.orgMonthlyLimitUsd;
  if (limit <= 0) return { exceeded: false, spent: 0, limit: 0 }; // unlimited

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const spent = await monthlyOrgSpend(organizationId, period);
  return { exceeded: spent >= limit, spent, limit };
}
