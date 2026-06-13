import crypto from "node:crypto";
import { Organization, Subscription, ProcessedWebhook } from "../models/index.js";
import { logger } from "../config/logger.js";
import { NotFoundError } from "../utils/errors.js";
import { planByPriceId } from "../config/plans.js";
import { recordEarnedCommissionForOrg } from "./affiliate.service.js";

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
  const plan = (priceId && (await planByPriceId())[priceId]) ?? "pro";

  await Subscription.findOneAndUpdate(
    { organizationId },
    {
      organizationId,
      paddleSubscriptionId: data.id,
      paddleCustomerId: data.customer_id,
      plan,
      status: data.status,
      currentPeriodStart: data.current_billing_period?.starts_at
        ? new Date(data.current_billing_period.starts_at)
        : new Date(),
      currentPeriodEnd: data.current_billing_period?.ends_at
        ? new Date(data.current_billing_period.ends_at)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      canceledAt: data.canceled_at ? new Date(data.canceled_at) : undefined,
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

  // Affiliate: when a referred org first activates a paid plan, earn the
  // referrer's commission (no-op if there's no pending referral).
  if (data.status === "active") {
    const sub = await Subscription.findOne({ organizationId }).select("_id").lean();
    await recordEarnedCommissionForOrg(organizationId, plan, sub?._id);
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
  const result = (await paddleFetch(`/customers/${org.paddleCustomerId}/portal-sessions`, {
    method: "POST",
    body: JSON.stringify({}),
  })) as { data?: { urls?: { general?: { overview?: string } } } };
  const url = result.data?.urls?.general?.overview;
  if (!url) throw new Error("Paddle portal session returned no URL.");
  return { url };
}
