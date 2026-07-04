import type { ToolDefinitionDocType } from "../../models/ToolDefinition.js";

export type GuardrailViolation = {
  blocked: true;
  reason: string;
};

export type GuardrailPass = { blocked: false };

export type GuardrailResult = GuardrailViolation | GuardrailPass;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

// Plan ordering for subscription guardrails (upgradeOnly).
const PLAN_RANK: Record<string, number> = { starter: 0, pro: 1, business: 2, enterprise: 3 };

function looksLikeRealName(name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return false;
  // Reject obvious placeholders the model falls back to.
  return !/^(customer|guest|user|attendee|test|unknown|n\/?a|none|\[name\]|the customer)$/i.test(n);
}

/**
 * Evaluates the tool definition's guardrail config against the (enriched) call
 * arguments. Returns { blocked: false } if all checks pass, or
 * { blocked: true, reason } on the first violation. `toolKey` lets checks apply
 * only to the tool they're meant for (e.g. business hours → book_meeting).
 */
export function evaluateGuardrails(
  guardrails: ToolDefinitionDocType["guardrails"],
  args: Record<string, unknown>,
  toolKey?: string,
): GuardrailResult {
  if (!guardrails) return { blocked: false };

  // ---- Refund / amount limits (refund_payment, issue_refund) ----------------
  if (typeof guardrails.maxAmount === "number") {
    const amount = Number(args.amount ?? args.refundAmount ?? 0);
    if (!isNaN(amount) && amount > guardrails.maxAmount) {
      return {
        blocked: true,
        reason: `Amount $${amount.toFixed(2)} exceeds the maximum allowed refund of $${guardrails.maxAmount.toFixed(2)}.`,
      };
    }
  }

  if (typeof guardrails.maxDaysSincePurchase === "number") {
    let days: number | null = null;
    if (args.daysSincePurchase !== undefined) {
      const n = Number(args.daysSincePurchase);
      if (!isNaN(n)) days = n;
    } else {
      const rawDate = args.purchaseDate ?? args.orderDate;
      if (rawDate) {
        const t = new Date(String(rawDate)).getTime();
        if (!isNaN(t)) days = Math.floor((Date.now() - t) / 86_400_000);
      }
    }
    if (days !== null && days > guardrails.maxDaysSincePurchase) {
      return {
        blocked: true,
        reason: `This action is only allowed within ${guardrails.maxDaysSincePurchase} days of purchase (order is ${days} days old).`,
      };
    }
  }

  // ---- Contact allow-list ----------------------------------------------------
  if (guardrails.allowedContactEmails && guardrails.allowedContactEmails.length > 0) {
    const email = String(args.email ?? args.contactEmail ?? "").toLowerCase();
    if (email && !guardrails.allowedContactEmails.includes(email)) {
      return { blocked: true, reason: "This tool is restricted to specific contacts." };
    }
  }

  // ---- Booking window (book_meeting) ----------------------------------------
  // The chosen slot must fall on an allowed weekday and within the allowed
  // window, evaluated in the operator's business-hours timezone.
  if (
    (toolKey === undefined || toolKey === "book_meeting") &&
    guardrails.businessHoursStart &&
    guardrails.businessHoursEnd
  ) {
    const iso = String(args.startTime ?? args.start ?? "");
    const when = iso ? new Date(iso) : null;
    if (when && !isNaN(when.getTime())) {
      const tz = guardrails.businessHoursTz || "UTC";
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
        }).formatToParts(when);
        const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
        const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
        const wd = WEEKDAY_INDEX[parts.find((p) => p.type === "weekday")?.value ?? ""];
        const minutes = hh * 60 + mm;
        const [sh, sm] = guardrails.businessHoursStart.split(":").map(Number);
        const [eh, em] = guardrails.businessHoursEnd.split(":").map(Number);
        const startMin = sh * 60 + (sm || 0);
        const endMin = eh * 60 + (em || 0);
        const days = guardrails.businessDays && guardrails.businessDays.length > 0
          ? guardrails.businessDays
          : [1, 2, 3, 4, 5];
        const outOfHours = minutes < startMin || minutes >= endMin;
        if (wd !== undefined && (!days.includes(wd) || outOfHours)) {
          return {
            blocked: true,
            reason: `Meetings can only be booked during business hours (${guardrails.businessHoursStart}–${guardrails.businessHoursEnd} ${tz}, on allowed days). Please pick another slot.`,
          };
        }
      } catch {
        /* bad timezone / parse — don't block on a config error */
      }
    }
  }

  // ---- Named attendee (book_meeting) ----------------------------------------
  if (
    guardrails.requireNamedAttendee &&
    (toolKey === undefined || toolKey === "book_meeting")
  ) {
    const name = String(args.name ?? args.attendeeName ?? "").trim();
    if (!looksLikeRealName(name)) {
      return {
        blocked: true,
        reason: "A real attendee name is required before booking. Ask the customer for their full name.",
      };
    }
  }

  // ---- Subscription: upgrade-only (block downgrades through the AI) ----------
  if (guardrails.upgradeOnly) {
    if (toolKey === "downgrade_subscription") {
      return { blocked: true, reason: "Downgrades aren't available through the assistant — please contact support." };
    }
    // If a target plan is given and we can rank it below the current, block too.
    const target = String(args.targetPlan ?? "").toLowerCase();
    const current = String(args.currentPlan ?? "").toLowerCase();
    if (target && current && PLAN_RANK[target] !== undefined && PLAN_RANK[current] !== undefined) {
      if (PLAN_RANK[target] < PLAN_RANK[current]) {
        return { blocked: true, reason: `Only upgrades are allowed here — ${target} is below the current ${current} plan.` };
      }
    }
  }

  // ---- Billing owner (subscription / refund) --------------------------------
  // The customer must be identified by their account email (the widget injects
  // the verified ContactSession email). Without one we can't confirm ownership.
  if (guardrails.requireBillingOwner) {
    const email = String(args.email ?? args.contactEmail ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return {
        blocked: true,
        reason: "This action requires a verified account holder. Please confirm the email on the account first.",
      };
    }
  }

  return { blocked: false };
}
