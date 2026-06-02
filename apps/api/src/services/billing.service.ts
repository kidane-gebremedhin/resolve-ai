import crypto from "node:crypto";
import { Organization, Subscription } from "../models/index.js";
import { logger } from "../config/logger.js";
import { NotFoundError } from "../utils/errors.js";

const PLAN_BY_PRICE: Record<string, "starter" | "pro" | "enterprise"> = {};
if (process.env.PADDLE_PRICE_STARTER) PLAN_BY_PRICE[process.env.PADDLE_PRICE_STARTER] = "starter";
if (process.env.PADDLE_PRICE_PRO) PLAN_BY_PRICE[process.env.PADDLE_PRICE_PRO] = "pro";
if (process.env.PADDLE_PRICE_ENTERPRISE) PLAN_BY_PRICE[process.env.PADDLE_PRICE_ENTERPRISE] = "enterprise";

const PADDLE_API_BASE =
  (process.env.PADDLE_ENVIRONMENT ?? "sandbox") === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";

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
  const data = event.data;
  const organizationId = data.custom_data?.organizationId;
  if (!organizationId) {
    logger.warn("[billing] event missing custom_data.organizationId", { id: data.id });
    return;
  }
  const priceId = data.items?.[0]?.price?.id;
  const plan = (priceId && PLAN_BY_PRICE[priceId]) ?? "starter";

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
  await Organization.findByIdAndUpdate(organizationId, {
    plan: data.status === "active" || data.status === "trialing" ? plan : "free",
    paddleSubscriptionId: data.id,
    paddleCustomerId: data.customer_id,
  });
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
