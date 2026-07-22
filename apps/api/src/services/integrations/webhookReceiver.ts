import crypto from "node:crypto";
import type { Types } from "mongoose";
import { ExternalSubscription, ProcessedWebhook, Organization } from "../../models/index.js";
import { logger } from "../../config/logger.js";
import {
  classifyReceiptAction,
  sendSubscriptionReceipt,
} from "../subscription-receipt.service.js";

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
    // A pending change scheduled for period end (e.g. a cancel-at-period-end, which is
    // how the widget cancels). Present before the definitive `subscription.canceled`.
    scheduled_change?: { action?: string; effective_at?: string } | null;
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
  const price = priceId ? await resolvePaddlePriceAmount(conn, priceId) : undefined;
  // Treat a scheduled cancel-at-period-end as a cancellation so the customer is notified
  // when they cancel, not only when the subscription finally ends.
  const scheduledCancel =
    data.scheduled_change?.action === "cancel"
      ? (data.scheduled_change.effective_at ?? new Date().toISOString())
      : undefined;

  await upsertSnapshot({
    conn,
    provider: "paddle",
    externalSubscriptionId: data.id,
    externalCustomerId: data.customer_id,
    email,
    plan,
    status: data.status,
    priceId,
    amount: price?.amount,
    currency: price?.currency,
    billingInterval: interval === "year" ? "year" : interval === "month" ? "month" : undefined,
    currentPeriodEnd: data.current_billing_period?.ends_at,
    canceledAt: data.canceled_at ?? scheduledCancel ?? undefined,
    eventType: event.event_type,
    raw: event,
  });
}

// Fetch a Paddle price's recurring amount (major units) + currency for receipts and
// upgrade/downgrade classification. Best-effort — returns undefined on any failure.
async function resolvePaddlePriceAmount(
  conn: ReceiverConnection,
  priceId: string,
): Promise<{ amount: number; currency: string } | undefined> {
  if (!conn.apiKey) return undefined;
  const baseUrl = conn.sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  try {
    const res = await fetch(`${baseUrl}/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${conn.apiKey}` },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data?: { unit_price?: { amount?: string; currency_code?: string } } };
    const raw = json.data?.unit_price?.amount;
    const currency = json.data?.unit_price?.currency_code;
    if (raw == null || !currency) return undefined;
    // Paddle amounts are in the currency's minor units (e.g. cents).
    const amount = Number(raw) / 100;
    if (!Number.isFinite(amount)) return undefined;
    return { amount, currency: currency.toUpperCase() };
  } catch (err) {
    logger.warn("[webhookReceiver] paddle price lookup failed", { err: (err as Error).message });
    return undefined;
  }
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
      // The widget cancels via cancel_at_period_end; the definitive delete fires later.
      cancel_at_period_end?: boolean;
      cancel_at?: number | null;
      items?: {
        data?: {
          // Stripe API 2025-03-31+ carries the period on the item, not the subscription.
          current_period_end?: number;
          price?: {
            id?: string;
            nickname?: string;
            unit_amount?: number | null;
            currency?: string;
            recurring?: { interval?: string };
          };
        }[];
      };
    };
  };
};

export async function handleStripeSubscriptionEvent(conn: ReceiverConnection, event: StripeEvent): Promise<void> {
  if (!event.type?.startsWith("customer.subscription.")) return;
  const obj = event.data?.object;
  if (!obj?.id) return;
  if (!(await claimEvent("stripe", String(conn._id), event.id))) return;

  const item0 = obj.items?.data?.[0];
  const price = item0?.price;
  const interval = price?.recurring?.interval;
  const periodEnd = item0?.current_period_end ?? obj.current_period_end;
  const email = obj.customer ? await resolveStripeCustomerEmail(conn, obj.customer) : undefined;
  // Stripe embeds the price (with unit_amount in minor units) in subscription events.
  const amount =
    price?.unit_amount != null && Number.isFinite(price.unit_amount) ? price.unit_amount / 100 : undefined;
  // A scheduled cancel-at-period-end counts as a cancellation for the receipt (the
  // widget cancels this way); `cancel_at` (or now) marks when it takes effect.
  const scheduledCancelTs =
    obj.cancel_at_period_end === true ? (obj.cancel_at ?? Math.floor(Date.now() / 1000)) : undefined;
  const canceledTs = obj.canceled_at ?? scheduledCancelTs;

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
    amount,
    currency: price?.currency ? price.currency.toUpperCase() : undefined,
    billingInterval: interval === "year" ? "year" : interval === "month" ? "month" : undefined,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined,
    canceledAt: canceledTs ? new Date(canceledTs * 1000).toISOString() : undefined,
    eventType: event.type,
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
  amount?: number;
  currency?: string;
  billingInterval?: "month" | "year";
  currentPeriodEnd?: string;
  canceledAt?: string;
  eventType?: string;
  raw?: unknown;
}): Promise<void> {
  // Read the prior snapshot BEFORE the upsert so we can tell a creation from an
  // upgrade/downgrade/cancel for the receipt email.
  const prior = await ExternalSubscription.findOne({
    connectionId: args.conn._id,
    externalSubscriptionId: args.externalSubscriptionId,
  })
    .select("plan status amount customerEmail canceledAt pendingReceipt")
    .lean();

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
  if (args.amount != null) set.amount = args.amount;
  if (args.currency) set.currency = args.currency;
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

  // Receipt email to the operator's CUSTOMER, under the operator's brand. Fire-and-forget
  // so a mail hiccup never affects webhook processing; renewals/no-op events send nothing.
  void sendExternalReceipt(args, prior);
}

async function sendExternalReceipt(
  args: Parameters<typeof upsertSnapshot>[0],
  prior: {
    plan?: string | null;
    status?: string | null;
    amount?: number | null;
    customerEmail?: string | null;
    canceledAt?: Date | null;
    pendingReceipt?: { action?: string | null; at?: Date | null } | null;
  } | null,
): Promise<void> {
  try {
    const to = args.email ?? prior?.customerEmail ?? undefined;
    if (!to) return; // no customer to notify

    // A widget tool change stamps the precise action (upgraded/downgraded/canceled). Prefer
    // it when recent — the dispatcher's eager write clobbers the prior plan/amount we'd
    // otherwise infer direction from. Consuming it (clearing below) also dedupes.
    const pending = prior?.pendingReceipt;
    const pendingFresh =
      pending?.action && pending.at ? Date.now() - new Date(pending.at).getTime() < 15 * 60_000 : false;

    const priorActive = prior?.status === "active" || prior?.status === "trialing";
    const isActiveNow = args.status === "active" || args.status === "trialing";
    const canceledNow =
      args.eventType?.endsWith(".canceled") === true ||
      args.eventType === "customer.subscription.deleted" ||
      args.status === "canceled" ||
      args.status === "paused" ||
      (Boolean(args.canceledAt) && !prior?.canceledAt);

    const action = pendingFresh
      ? (pending!.action as "upgraded" | "downgraded" | "canceled")
      : classifyReceiptAction({
          hadActivePrior: priorActive,
          isActiveNow,
          isCanceled: canceledNow,
          planChanged:
            (prior?.plan ?? null) !== (args.plan ?? null) || (prior?.amount ?? null) !== (args.amount ?? null),
          priorLevel: prior?.amount ?? null,
          newLevel: args.amount ?? null,
        });

    // Consume the pending hint regardless of outcome so a later event (e.g. the definitive
    // cancel) doesn't re-use it.
    if (pending) {
      await ExternalSubscription.updateOne(
        { connectionId: args.conn._id, externalSubscriptionId: args.externalSubscriptionId },
        { $unset: { pendingReceipt: 1 } },
      ).catch(() => {});
    }

    if (!action) return;
    // A cancel is observed twice (scheduled at period end, then the definitive event).
    // If we already recorded a cancellation, don't email a second time.
    if (action === "canceled" && !pendingFresh && prior?.canceledAt) return;

    const org = await Organization.findById(args.conn.organizationId).select("name").lean();
    const brand = (org?.name as string | undefined) ?? undefined;
    const appName = process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? "Support";

    await sendSubscriptionReceipt({
      to,
      action,
      planName: args.plan ?? "your plan",
      amount: args.amount ?? null,
      currency: args.currency ?? "USD",
      billingInterval: args.billingInterval ?? null,
      periodEnd: args.currentPeriodEnd ? new Date(args.currentPeriodEnd) : null,
      appName,
      brandName: brand ?? appName,
      fromName: brand ?? appName,
      billingUrl: null, // the operator's own billing portal URL isn't known here
    });
  } catch (err) {
    logger.warn("[webhookReceiver] customer receipt failed", { err: (err as Error).message });
  }
}
