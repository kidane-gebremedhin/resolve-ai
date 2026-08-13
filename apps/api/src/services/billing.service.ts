import crypto from "node:crypto";
import { Organization, Subscription, ProcessedWebhook, User, Membership } from "../models/index.js";
import { logger } from "../config/logger.js";
import { ApiError, NotFoundError } from "../utils/errors.js";
import { planByPriceId, loadPlanCatalog, PLAN_DISPLAY_NAMES, type Plan } from "../config/plans.js";
import { recordEarnedCommissionForOrg } from "./affiliate.service.js";
import {
  classifyReceiptAction,
  orgBillingRecipientEmails,
  sendSubscriptionReceipt,
} from "./subscription-receipt.service.js";

// Tier rank so a plan change can be classified as an upgrade vs a downgrade.
const PLATFORM_PLAN_RANK: Record<Plan, number> = { pro: 1, business: 2, enterprise: 3 };

// Paddle's overlay checkout creates the customer with just an email (no name), so the Paddle
// dashboard shows the customer as "-". Backfill the name from the org's owner when the Paddle
// customer has none, so registered accounts are identifiable there. Best-effort + idempotent
// (it GETs first and only PATCHes an empty name), and never throws to its caller.
async function backfillPaddleCustomerName(customerId: string, organizationId: string): Promise<void> {
  try {
    const res = (await paddleFetch(`/customers/${customerId}`)) as { data?: { name?: string | null } };
    if (res.data?.name && String(res.data.name).trim()) return; // already named
    const owner = await Membership.findOne({ organizationId, role: "owner", status: "active" })
      .select("userId")
      .lean();
    if (!owner) return;
    const user = await User.findById(owner.userId).select("name").lean();
    const name = (user?.name as string | undefined)?.trim();
    if (!name) return;
    await paddleFetch(`/customers/${customerId}`, { method: "PATCH", body: JSON.stringify({ name }) });
    logger.info("[billing] backfilled paddle customer name", { customerId, organizationId });
  } catch (err) {
    logger.warn("[billing] paddle customer name backfill failed", { err: (err as Error).message });
  }
}

const PADDLE_API_BASE =
  (process.env.PADDLE_ENVIRONMENT ?? "sandbox") === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";

// Startup sanity check: a sandbox key with PADDLE_ENVIRONMENT=production (or
// vice-versa) silently breaks checkout. Warn loudly rather than fail.
(function assertPaddleEnvConsistency() {
  const env = process.env.PADDLE_ENVIRONMENT ?? "sandbox";
  const key = process.env.PADDLE_API_KEY ?? "";
  const looksLive = /pdl_live_/.test(key);
  const looksSandbox = /pdl_sdbx_|pdl_test_/.test(key);
  if (env === "production" && looksSandbox) {
    logger.warn("[billing] PADDLE_ENVIRONMENT=production but API key looks like a sandbox key.");
  }
  if (env !== "production" && looksLive) {
    logger.warn("[billing] PADDLE_ENVIRONMENT=sandbox but a LIVE Paddle API key is configured.");
  }
})();

export function verifyPaddleSignature(rawBody: string, header: string | undefined): boolean {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!header) return false;
  // Paddle Billing signs as `ts=<ts>;h1=<hmac>`.
  const parts = Object.fromEntries(header.split(";").map((p) => p.split("=") as [string, string]));
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(h1, "hex"));
  } catch {
    return false;
  }
}

type SubscriptionEvent = {
  event_id?: string;
  event_type: string;
  data: {
    id: string;
    customer_id: string;
    status: "active" | "trialing" | "past_due" | "canceled" | "paused";
    items?: { price?: { id?: string } }[];
    current_billing_period?: { starts_at: string; ends_at: string };
    canceled_at?: string;
    // A pending change scheduled for period end (Paddle). action "cancel" means the
    // subscription is set to cancel at `effective_at` while still active until then.
    scheduled_change?: { action?: string; effective_at?: string } | null;
    custom_data?: { organizationId?: string };
  };
};

export async function handlePaddleEvent(event: SubscriptionEvent): Promise<void> {
  if (!event.event_type?.startsWith("subscription.")) return;

  // Idempotency: Paddle retries deliveries. Record the event id and no-op if
  // we've already applied it. A duplicate insert (unique index) means "seen".
  if (event.event_id) {
    try {
      await ProcessedWebhook.create({ provider: "paddle", eventId: event.event_id });
    } catch {
      logger.info("[billing] duplicate webhook event ignored", { eventId: event.event_id });
      return;
    }
  }

  const data = event.data;
  const organizationId = data.custom_data?.organizationId;
  if (!organizationId) {
    logger.warn("[billing] event missing custom_data.organizationId", { id: data.id });
    return;
  }
  const priceId = data.items?.[0]?.price?.id;
  const catalog = await loadPlanCatalog();
  const plan = (priceId && (await planByPriceId())[priceId]) ?? "pro";
  const yearlyPriceIds = new Set(catalog.map((c) => c.priceIdYearly).filter(Boolean));
  const billingInterval: "month" | "year" = priceId && yearlyPriceIds.has(priceId) ? "year" : "month";

  // Snapshot the prior state BEFORE the upsert so we can tell a creation from an
  // upgrade/downgrade/cancel and email the right receipt.
  const prior = await Subscription.findOne({ organizationId })
    .select("plan status canceledAt")
    .lean();

  await Subscription.findOneAndUpdate(
    { organizationId },
    {
      organizationId,
      paddleSubscriptionId: data.id,
      paddleCustomerId: data.customer_id,
      plan,
      billingInterval,
      status: data.status,
      currentPeriodStart: data.current_billing_period?.starts_at
        ? new Date(data.current_billing_period.starts_at)
        : new Date(),
      currentPeriodEnd: data.current_billing_period?.ends_at
        ? new Date(data.current_billing_period.ends_at)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      canceledAt: data.canceled_at ? new Date(data.canceled_at) : undefined,
      // Track a scheduled cancel-at-period-end so the dashboard can warn about it while the
      // plan is still active. Cleared (set null) when Paddle reports no such scheduled change.
      cancelScheduledAt:
        data.scheduled_change?.action === "cancel" && data.scheduled_change.effective_at
          ? new Date(data.scheduled_change.effective_at)
          : null,
      paddleData: event,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Mirror plan onto Organization for fast plan-gate lookups.
  const isActive = data.status === "active" || data.status === "trialing";
  await Organization.findByIdAndUpdate(
    organizationId,
    isActive
      ? { $set: { plan, paddleSubscriptionId: data.id, paddleCustomerId: data.customer_id } }
      : { $unset: { plan: 1 }, $set: { paddleSubscriptionId: data.id, paddleCustomerId: data.customer_id } },
  );

  // Give the Paddle customer a name (from the org owner) if the overlay checkout left it blank,
  // so it isn't shown as "-" in Paddle. Fire-and-forget; runs on the post-checkout reconcile too.
  if (data.customer_id) {
    void backfillPaddleCustomerName(data.customer_id, organizationId);
  }

  // Receipt email to the org's owner/admins on create / upgrade / downgrade / cancel.
  // Fire-and-forget so a mail hiccup never blocks the webhook 200. Renewals send nothing.
  void (async () => {
    const priorActive = prior?.status === "active" || prior?.status === "trialing";
    const canceledNow =
      event.event_type?.endsWith(".canceled") === true ||
      data.status === "canceled" ||
      data.status === "paused" ||
      (Boolean(data.canceled_at) && !prior?.canceledAt);
    const action = classifyReceiptAction({
      hadActivePrior: priorActive,
      isActiveNow: isActive,
      isCanceled: canceledNow,
      planChanged: (prior?.plan ?? null) !== plan,
      priorLevel: prior?.plan ? PLATFORM_PLAN_RANK[prior.plan as Plan] : null,
      newLevel: PLATFORM_PLAN_RANK[plan as Plan] ?? null,
    });
    if (!action) return;
    // Don't email a second cancellation receipt if we already recorded one.
    if (action === "canceled" && prior?.canceledAt) return;
    const emails = await orgBillingRecipientEmails(organizationId);
    if (emails.length === 0) return;
    const entry = catalog.find((c) => c.plan === plan);
    const amount = billingInterval === "year" ? entry?.priceYearlyUsd : entry?.priceMonthlyUsd;
    const appName = process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? "Platform";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    await sendSubscriptionReceipt({
      to: emails,
      action,
      planName: PLAN_DISPLAY_NAMES[plan as Plan] ?? String(plan),
      amount: amount ?? null,
      currency: "USD",
      billingInterval,
      periodEnd: data.current_billing_period?.ends_at ? new Date(data.current_billing_period.ends_at) : null,
      appName,
      brandName: appName,
      billingUrl: appUrl ? `${appUrl}/app/billing` : null,
    });
  })().catch((err) => logger.warn("[billing] receipt email failed", { organizationId, err: String(err) }));

  // Affiliate: when a referred org first activates a paid plan, earn the
  // referrer's commission (no-op if there's no pending referral).
  // Fire-and-forget: a failure here must NOT prevent the webhook 200 response —
  // Paddle would retry, but our idempotency guard would skip the re-run, leaving
  // the commission unrecorded permanently.
  if (data.status === "active") {
    Subscription.findOne({ organizationId })
      .select("_id")
      .lean()
      .then((sub) => recordEarnedCommissionForOrg(organizationId, plan, sub?._id))
      .catch((err) =>
        logger.warn("[billing] affiliate commission recording failed", {
          organizationId,
          err: String(err),
        }),
      );
  }
}

async function paddleFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) throw new Error("PADDLE_API_KEY not set");
  const res = await fetch(`${PADDLE_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Paddle ${path} ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export type CheckoutResult = {
  // When using Paddle.js overlay, the client opens a checkout with the
  // priceId + customData. For server-redirect flows you'd return a URL.
  // We return both so the dashboard can choose.
  mode: "overlay" | "redirect";
  priceId: string;
  customData: { organizationId: string };
  url?: string;
};

export async function createCheckoutSession(args: {
  organizationId: string;
  priceId: string;
  successUrl?: string;
}): Promise<CheckoutResult> {
  // Paddle Billing's overlay checkout is initiated client-side via Paddle.js
  // with `Paddle.Checkout.open({ items, customData })`. The server just
  // returns the parameters; no API call needed in the basic flow.
  // For enterprise self-serve, you might mint a hosted-checkout URL via:
  // POST /transactions and use checkout.url. For now we return overlay params.
  return {
    mode: "overlay",
    priceId: args.priceId,
    customData: { organizationId: args.organizationId },
    url: args.successUrl,
  };
}

// Activate a subscription directly from a completed checkout transaction —
// WITHOUT waiting for the webhook. Used right after the Paddle overlay reports
// `checkout.completed` so the dashboard unlocks immediately (the webhook can't
// reach localhost, and even in prod there's a delivery delay). Fetches the
// transaction, finds its subscription, verifies the org, and upserts. Returns
// whether the subscription is now entitled.
export async function activateFromTransaction(
  transactionId: string,
  expectedOrgId: string,
): Promise<boolean> {
  const result = (await paddleFetch(`/transactions/${transactionId}`)) as {
    data?: {
      id: string;
      subscription_id?: string;
      custom_data?: { organizationId?: string } | null;
      status?: string;
    };
  };
  const d = result.data;
  if (!d) throw new NotFoundError("Transaction not found in Paddle.");
  const orgId = d.custom_data?.organizationId;
  if (orgId && orgId !== expectedOrgId) {
    throw new NotFoundError("Transaction does not belong to this organization.");
  }
  if (!d.subscription_id) {
    return false; // subscription not yet linked (rare timing); webhook will follow
  }
  await syncSubscriptionFromPaddle(d.subscription_id);
  const sub = await Subscription.findOne({ organizationId: expectedOrgId })
    .select("status")
    .lean();
  return Boolean(sub && (sub.status === "active" || sub.status === "trialing"));
}

// Reconcile a subscription's local record from Paddle (used by the admin
// "Refresh status" action). Fetches the live subscription and re-applies it
// through the same upsert path. Bypasses idempotency (no event_id).
export async function syncSubscriptionFromPaddle(paddleSubscriptionId: string): Promise<void> {
  const result = (await paddleFetch(`/subscriptions/${paddleSubscriptionId}`)) as {
    data?: SubscriptionEvent["data"];
  };
  const d = result.data;
  if (!d) throw new NotFoundError("Subscription not found in Paddle.");
  if (!d.custom_data?.organizationId) {
    const existing = await Subscription.findOne({ paddleSubscriptionId })
      .select("organizationId")
      .lean();
    if (existing) {
      d.custom_data = { ...(d.custom_data ?? {}), organizationId: existing.organizationId.toString() };
    }
  }
  await handlePaddleEvent({ event_type: "subscription.reconcile", data: d });
}

// Schedule a plan change at the next billing renewal (no immediate charge).
// Uses Paddle's subscription update API with proration_billing_mode="do_not_bill"
// so the customer's plan switches at the end of their current period.
export async function changePlan(args: {
  organizationId: string;
  priceId: string;
}): Promise<{ scheduledAt: string | null }> {
  const org = await Organization.findById(args.organizationId)
    .select("paddleSubscriptionId")
    .lean();
  if (!org?.paddleSubscriptionId) {
    throw new NotFoundError("No active Paddle subscription found for this organization.");
  }
  const result = (await paddleFetch(`/subscriptions/${org.paddleSubscriptionId}`, {
    method: "PATCH",
    body: JSON.stringify({
      items: [{ price_id: args.priceId, quantity: 1 }],
      proration_billing_mode: "do_not_bill",
    }),
  })) as { data?: { scheduled_change?: { effective_at?: string } } };
  return { scheduledAt: result.data?.scheduled_change?.effective_at ?? null };
}

export async function createCustomerPortalSession(args: {
  organizationId: string;
}): Promise<{ url: string }> {
  const org = await Organization.findById(args.organizationId);
  if (!org) throw new NotFoundError("Organization not found.");
  if (!org.paddleCustomerId) {
    throw new NotFoundError("No active Paddle customer for this organization.");
  }
  // A failure here is Paddle's, not ours — an unknown/deleted customer id, a
  // revoked API key, or a provider outage. Letting the raw error bubble turned
  // all of those into a bare "Internal server error." with no way for the
  // operator to tell what to do about it. Translate to a 502 that names the
  // cause, and keep the real reason in the log.
  let result: { data?: { urls?: { general?: { overview?: string } } } };
  try {
    result = (await paddleFetch(`/customers/${org.paddleCustomerId}/portal-sessions`, {
      method: "POST",
      body: JSON.stringify({}),
    })) as typeof result;
  } catch (err) {
    const detail = (err as Error).message;
    logger.error("[billing] paddle portal session failed", {
      organizationId: args.organizationId,
      paddleCustomerId: org.paddleCustomerId,
      err: detail,
    });
    // 404 from Paddle means this org's customer id isn't a real Paddle object —
    // typically a seeded/imported org, or a customer deleted on Paddle's side.
    if (/\s404:/.test(detail)) {
      throw new ApiError(
        502,
        "paddle_customer_unknown",
        "This workspace isn't linked to a live Paddle customer, so the billing portal can't be opened. " +
          "This happens for accounts whose plan was granted directly (seeded or coupon-redeemed) rather than bought through checkout.",
      );
    }
    throw new ApiError(
      502,
      "paddle_unavailable",
      "Could not reach the billing provider. Please try again in a moment.",
    );
  }

  const url = result.data?.urls?.general?.overview;
  if (!url) {
    logger.error("[billing] paddle portal session returned no URL", {
      organizationId: args.organizationId,
    });
    throw new ApiError(
      502,
      "paddle_unavailable",
      "The billing provider did not return a portal link. Please try again in a moment.",
    );
  }
  return { url };
}
