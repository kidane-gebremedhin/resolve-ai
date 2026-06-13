import mongoose from "mongoose";
import { Organization, Membership, User, Website, BudgetAlert, UsageRecord } from "../models/index.js";
import { budgetLimitsForPlan } from "../config/plans.js";
import { sendMail } from "./mailer.service.js";
import { logger } from "../config/logger.js";

const THRESHOLDS: Array<75 | 100> = [75, 100];

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
  threshold: 75 | 100,
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
  threshold: 75 | 100,
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

// Fetch admin/owner emails for an org to use as alert recipients.
async function orgAdminEmails(organizationId: string): Promise<string[]> {
  const memberships = await Membership.find({
    organizationId,
    role: { $in: ["owner", "admin"] },
    status: "active",
  })
    .select("userId")
    .lean();

  if (!memberships.length) return [];

  const userIds = memberships.map((m) => m.userId);
  const users = await User.find({ _id: { $in: userIds } })
    .select("email")
    .lean();

  return users.map((u) => u.email as string).filter(Boolean);
}

function budgetEmailHtml(opts: {
  threshold: 75 | 100;
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

// Called after every UsageRecord is saved. Computes current spend and sends
// alerts at 75% and 100% thresholds (each sent at most once per period).
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

  const orgSpent = await monthlyOrgSpend(organizationId, period);
  const emails = await orgAdminEmails(organizationId);

  // Org-level alerts
  if (budgetLimits.orgMonthlyLimitUsd > 0 && emails.length > 0) {
    for (const threshold of THRESHOLDS) {
      const pct = (orgSpent / budgetLimits.orgMonthlyLimitUsd) * 100;
      if (pct >= threshold) {
        const alreadySent = await alertAlreadySent("org", organizationId, period, threshold);
        if (!alreadySent) {
          const { subject, html } = budgetEmailHtml({
            threshold,
            entityLabel: `organization "${org.name as string}"`,
            spent: orgSpent,
            limit: budgetLimits.orgMonthlyLimitUsd,
            period,
            appName,
            billingUrl,
          });
          await Promise.all(emails.map((to) => sendMail({ to, subject, html })));
          await markAlertSent("org", organizationId, period, threshold);
          logger.info("[budget-alert] sent org alert", { organizationId, period, threshold });
        }
      }
    }
  }

  // Website-level alerts
  if (websiteId && budgetLimits.websiteMonthlyLimitUsd > 0 && emails.length > 0) {
    const websiteSpent = await monthlyWebsiteSpend(websiteId, period);
    const website = await Website.findById(websiteId).select("name").lean();
    const websiteLabel = website?.name ? `website "${website.name as string}"` : "website";

    for (const threshold of THRESHOLDS) {
      const pct = (websiteSpent / budgetLimits.websiteMonthlyLimitUsd) * 100;
      if (pct >= threshold) {
        const alreadySent = await alertAlreadySent("website", websiteId, period, threshold);
        if (!alreadySent) {
          const { subject, html } = budgetEmailHtml({
            threshold,
            entityLabel: websiteLabel,
            spent: websiteSpent,
            limit: budgetLimits.websiteMonthlyLimitUsd,
            period,
            appName,
            billingUrl,
          });
          await Promise.all(emails.map((to) => sendMail({ to, subject, html })));
          await markAlertSent("website", websiteId, period, threshold);
          logger.info("[budget-alert] sent website alert", { websiteId, period, threshold });
        }
      }
    }
  }
}
