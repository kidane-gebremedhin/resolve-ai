import crypto from "node:crypto";
import type { Types } from "mongoose";
import { ExternalSubscription, ProcessedWebhook } from "../../models/index.js";
import { logger } from "../../config/logger.js";

// Inbound webhook receiver for an OPERATOR's OWN Paddle/Stripe account. Each
// operator connection registers a callback URL that points here with its
// connectionId; the connection's stored `webhookSecret` verifies the signature.
// Verified subscription-lifecycle events are distilled into an ExternalSubscription
// snapshot so the assistant reflects out-of-band plan changes and keeps answering
// "what plan am I on?" even when the live API is momentarily unreachable.
//
// This is deliberately separate from the platform's own billing webhook
// (billing.service.ts / POST /billing/webhook), which tracks the SaaS's own
// subscriptions using the platform's PADDLE_WEBHOOK_SECRET.

export type ReceiverConnection = {
  _id: Types.ObjectId | string;
  organizationId: Types.ObjectId | string;
  provider: string;
  sandbox?: boolean;
  apiKey?: string; // active-env api key / access token, for resolving customer email
  planPrices?: Record<string, { monthly?: string; yearly?: string }>;
};

// ---- Signature verification -------------------------------------------------

// Paddle Billing signs as `ts=<ts>;h1=<hmac>`, HMAC-SHA256 over `${ts}:${rawBody}`.
export function verifyPaddleSignature(rawBody: string, header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(";").map((p) => p.split("=") as [string, string]));
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  return timingSafeHexEqual(expected, h1);
}

// Stripe signs as `t=<ts>,v1=<hmac>[,v1=<hmac>...]`, HMAC-SHA256 over `${t}.${rawBody}`.
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.split("="));
  const ts = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!ts || sigs.length === 0) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return sigs.some((s) => timingSafeHexEqual(expected, s));
}

function timingSafeHexEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

// ---- Idempotency ------------------------------------------------------------

// Providers retry deliveries. Record the (connection-scoped) event id and no-op on
// a duplicate. Returns true if this event is NEW and should be processed.
async function claimEvent(provider: string, connectionId: string, eventId: string | undefined): Promise<boolean> {
  if (!eventId) return true; // no id to dedupe on — process it
  try {
    await ProcessedWebhook.create({ provider, eventId: `${provider}:${connectionId}:${eventId}` });
    return true;
  } catch {
    logger.info("[webhookReceiver] duplicate event ignored", { provider, connectionId, eventId });
    return false;
  }
}

// ---- Paddle -----------------------------------------------------------------

type PaddleEvent = {
  event_id?: string;
  event_type?: string;
  data?: {
    id?: string;
    customer_id?: string;
    status?: string;
    items?: { price?: { id?: string; billing_cycle?: { interval?: string } } }[];
    current_billing_period?: { ends_at?: string };
    canceled_at?: string | null;
  };
};

export async function handlePaddleSubscriptionEvent(conn: ReceiverConnection, event: PaddleEvent): Promise<void> {
  if (!event.event_type?.startsWith("subscription.")) return;
  const data = event.data;
  if (!data?.id) return;
  if (!(await claimEvent("paddle", String(conn._id), event.event_id))) return;

  const priceId = data.items?.[0]?.price?.id;
  const interval = data.items?.[0]?.price?.billing_cycle?.interval;
  const plan = planNameForPriceId(conn.planPrices, priceId);
  const email = data.customer_id ? await resolvePaddleCustomerEmail(conn, data.customer_id) : undefined;

  await upsertSnapshot({
    conn,
    provider: "paddle",
    externalSubscriptionId: data.id,
    externalCustomerId: data.customer_id,
    email,
    plan,
    status: data.status,
    priceId,
    billingInterval: interval === "year" ? "year" : interval === "month" ? "month" : undefined,
    currentPeriodEnd: data.current_billing_period?.ends_at,
    canceledAt: data.canceled_at ?? undefined,
    raw: event,
  });
}

async function resolvePaddleCustomerEmail(conn: ReceiverConnection, customerId: string): Promise<string | undefined> {
  if (!conn.apiKey) return undefined;
  const baseUrl = conn.sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  try {
    const res = await fetch(`${baseUrl}/customers/${encodeURIComponent(customerId)}`, {
      headers: { Authorization: `Bearer ${conn.apiKey}` },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data?: { email?: string } };
    return json.data?.email?.toLowerCase();
  } catch (err) {
    logger.warn("[webhookReceiver] paddle customer email lookup failed", { err: (err as Error).message });
    return undefined;
  }
}

function planNameForPriceId(
  planPrices: ReceiverConnection["planPrices"],
  priceId: string | undefined,
): string | undefined {
  if (!planPrices || !priceId) return undefined;
  return Object.entries(planPrices).find(([, ids]) => ids.monthly === priceId || ids.yearly === priceId)?.[0];
}

// ---- Stripe -----------------------------------------------------------------

type StripeEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: {
      id?: string;
      customer?: string;
      status?: string;
      current_period_end?: number;
      canceled_at?: number | null;
      items?: { data?: { price?: { id?: string; nickname?: string; recurring?: { interval?: string } } }[] };
    };
  };
};

export async function handleStripeSubscriptionEvent(conn: ReceiverConnection, event: StripeEvent): Promise<void> {
  if (!event.type?.startsWith("customer.subscription.")) return;
  const obj = event.data?.object;
  if (!obj?.id) return;
  if (!(await claimEvent("stripe", String(conn._id), event.id))) return;

  const price = obj.items?.data?.[0]?.price;
  const interval = price?.recurring?.interval;
  const email = obj.customer ? await resolveStripeCustomerEmail(conn, obj.customer) : undefined;

  await upsertSnapshot({
    conn,
    provider: "stripe",
    externalSubscriptionId: obj.id,
    externalCustomerId: obj.customer,
    email,
    // Stripe has no operator plan-name map; fall back to the price nickname.
    plan: price?.nickname,
    status: obj.status,
    priceId: price?.id,
    billingInterval: interval === "year" ? "year" : interval === "month" ? "month" : undefined,
    currentPeriodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : undefined,
    canceledAt: obj.canceled_at ? new Date(obj.canceled_at * 1000).toISOString() : undefined,
    raw: event,
  });
}

async function resolveStripeCustomerEmail(conn: ReceiverConnection, customerId: string): Promise<string | undefined> {
  if (!conn.apiKey) return undefined;
  try {
    const auth = `Basic ${Buffer.from(`${conn.apiKey}:`).toString("base64")}`;
    const res = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
      headers: { Authorization: auth },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { email?: string };
    return json.email?.toLowerCase();
  } catch (err) {
    logger.warn("[webhookReceiver] stripe customer email lookup failed", { err: (err as Error).message });
    return undefined;
  }
}

// ---- Snapshot upsert --------------------------------------------------------

async function upsertSnapshot(args: {
  conn: ReceiverConnection;
  provider: string;
  externalSubscriptionId: string;
  externalCustomerId?: string;
  email?: string;
  plan?: string;
  status?: string;
  priceId?: string;
  billingInterval?: "month" | "year";
  currentPeriodEnd?: string;
  canceledAt?: string;
  raw?: unknown;
}): Promise<void> {
  const set: Record<string, unknown> = {
    organizationId: args.conn.organizationId,
    connectionId: args.conn._id,
    provider: args.provider,
    externalSubscriptionId: args.externalSubscriptionId,
  };
  // Only overwrite fields we actually resolved, so a partial event (e.g. one that
  // couldn't resolve the email) never wipes a value an earlier event captured.
  if (args.externalCustomerId) set.externalCustomerId = args.externalCustomerId;
  if (args.email) set.customerEmail = args.email;
  if (args.plan) set.plan = args.plan;
  if (args.status) set.status = args.status;
  if (args.priceId) set.priceId = args.priceId;
  if (args.billingInterval) set.billingInterval = args.billingInterval;
  if (args.currentPeriodEnd) set.currentPeriodEnd = new Date(args.currentPeriodEnd);
  set.canceledAt = args.canceledAt ? new Date(args.canceledAt) : null;
  if (args.raw !== undefined) set.raw = args.raw;

  await ExternalSubscription.updateOne(
    { connectionId: args.conn._id, externalSubscriptionId: args.externalSubscriptionId },
    { $set: set },
    { upsert: true },
  );
  logger.info("[webhookReceiver] subscription snapshot updated", {
    provider: args.provider,
    connectionId: String(args.conn._id),
    status: args.status,
    plan: args.plan,
  });
}
