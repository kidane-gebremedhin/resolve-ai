// Sends a branded "receipt" email whenever a subscription is created, upgraded,
// downgraded, or cancelled. Two callers use it:
//   1. Platform billing (billing.service.ts / handlePaddleEvent) — the operator's own
//      SaaS subscription; recipient = the org's owner/admin emails.
//   2. Operator-connected billing (webhookReceiver.ts) — the operator's OWN customers'
//      subscriptions; recipient = the customer's email, sent under the operator's brand.
//
// It is deliberately side-effect-light and never throws to its callers: a failed or
// unconfigured mailer must never break webhook processing (both callers invoke it
// fire-and-forget). Renewals / payment-method updates (no plan change) send nothing.

import { Membership, User } from "../models/index.js";
import { sendMail } from "./mailer.service.js";
import { logger } from "../config/logger.js";

export type ReceiptAction = "created" | "upgraded" | "downgraded" | "canceled";

// Decide which receipt (if any) an event warrants. `priorLevel`/`newLevel` are a
// monotonic measure of plan size — a tier rank for platform plans, or the recurring
// amount for operator plans — used only to tell an upgrade from a downgrade.
export function classifyReceiptAction(opts: {
  hadActivePrior: boolean;
  isActiveNow: boolean;
  isCanceled: boolean;
  planChanged: boolean;
  priorLevel?: number | null;
  newLevel?: number | null;
}): ReceiptAction | null {
  const { hadActivePrior, isActiveNow, isCanceled, planChanged, priorLevel, newLevel } = opts;
  // A cancellation (status cancelled/paused, or a newly-scheduled cancel) wins.
  if (isCanceled) return "canceled";
  // First time this subscription becomes active → a creation receipt.
  if (!hadActivePrior && isActiveNow) return "created";
  // Active-to-active plan change → upgrade or downgrade by level.
  if (hadActivePrior && isActiveNow && planChanged) {
    if (typeof priorLevel === "number" && typeof newLevel === "number" && priorLevel !== newLevel) {
      return newLevel > priorLevel ? "upgraded" : "downgraded";
    }
    // Plan changed but we can't tell direction — treat as an upgrade-style change so the
    // customer still gets a receipt of the new plan. (Direction is best-effort.)
    return "upgraded";
  }
  // Renewals, payment updates, no-op events → no receipt.
  return null;
}

const ACTION_TITLE: Record<ReceiptAction, string> = {
  created: "Subscription confirmed",
  upgraded: "Plan upgraded",
  downgraded: "Plan changed",
  canceled: "Subscription canceled",
};

const ACTION_ACCENT: Record<ReceiptAction, string> = {
  created: "#059669",
  upgraded: "#1d4ed8",
  downgraded: "#d97706",
  canceled: "#dc2626",
};

function formatMoney(amount: number | null | undefined, currency = "USD"): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export interface ReceiptEmailInput {
  action: ReceiptAction;
  planName: string;
  amount?: number | null;
  currency?: string;
  billingInterval?: "month" | "year" | null;
  periodEnd?: Date | null;
  appName: string;
  brandName?: string | null;
  billingUrl?: string | null;
}

export function buildSubscriptionReceiptEmail(input: ReceiptEmailInput): { subject: string; html: string } {
  const { action, planName, amount, currency, billingInterval, periodEnd, appName, brandName, billingUrl } = input;
  const heading = ACTION_TITLE[action];
  const accent = ACTION_ACCENT[action];
  const brand = (brandName || appName || "").trim();
  const money = formatMoney(amount, currency ?? "USD");
  const priced = money ? `${money}${billingInterval ? ` / ${billingInterval}` : ""}` : null;

  const intro: Record<ReceiptAction, string> = {
    created: `Thanks for subscribing. Here are the details of your <strong>${planName}</strong> plan.`,
    upgraded: `Your plan has been upgraded to <strong>${planName}</strong>. The prorated difference for the rest of this billing period has been charged.`,
    downgraded: `Your plan has been changed to <strong>${planName}</strong>. The new plan is now in effect.`,
    canceled: `Your <strong>${planName}</strong> subscription has been canceled. You'll keep access until the end of the current billing period.`,
  };

  const periodLabel = action === "canceled" ? "Access until" : "Next renewal";
  const rows: Array<[string, string]> = [["Plan", planName]];
  if (action !== "canceled" && priced) rows.push(["Amount", priced]);
  if (periodEnd) {
    rows.push([
      periodLabel,
      periodEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    ]);
  }

  const subject = brand ? `[${brand}] ${heading}` : heading;
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="color:#6b7280;padding:6px 16px 6px 0;white-space:nowrap">${k}</td><td style="font-weight:600;color:#111827">${v}</td></tr>`,
    )
    .join("");

  const cta = billingUrl
    ? `<p style="margin:24px 0 0">
         <a href="${billingUrl}" style="background:${accent};color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Manage billing</a>
       </p>`
    : "";

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      ${brand ? `<div style="font-weight:700;font-size:15px;color:#111827;margin-bottom:8px">${brand}</div>` : ""}
      <h2 style="color:${accent};margin:0 0 8px">${heading}</h2>
      <p style="color:#374151;line-height:1.6;margin:0">${intro[action]}</p>
      <table style="border-collapse:collapse;margin:20px 0 0">${rowsHtml}</table>
      ${cta}
      <p style="color:#9ca3af;font-size:12px;margin-top:28px">
        This is an automated receipt${brand ? ` from ${brand}` : ""}. Keep it for your records.
      </p>
    </div>`;
  return { subject, html };
}

// Resolve an org's owner/admin recipient emails (the platform-subscription audience).
export async function orgBillingRecipientEmails(organizationId: unknown): Promise<string[]> {
  const memberships = await Membership.find({
    organizationId,
    role: { $in: ["owner", "admin"] },
    status: "active",
  })
    .select("userId")
    .lean();
  if (!memberships.length) return [];
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } })
    .select("email")
    .lean();
  return users.map((u) => u.email as string).filter(Boolean);
}

// Build + send a receipt. Never throws — logs and returns on any failure so callers
// can fire-and-forget without a try/catch of their own.
export async function sendSubscriptionReceipt(
  args: ReceiptEmailInput & { to: string | string[]; fromName?: string | null },
): Promise<void> {
  const recipients = (Array.isArray(args.to) ? args.to : [args.to]).filter(Boolean);
  if (recipients.length === 0) return;
  try {
    const { subject, html } = buildSubscriptionReceiptEmail(args);
    await Promise.all(
      recipients.map((to) =>
        sendMail({ to, subject, html, fromName: args.fromName ?? args.brandName ?? undefined }),
      ),
    );
    logger.info("[subscription-receipt] sent", {
      action: args.action,
      plan: args.planName,
      recipients: recipients.length,
    });
  } catch (err) {
    logger.warn("[subscription-receipt] send failed", { err: (err as Error).message });
  }
}
