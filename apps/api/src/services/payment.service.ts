// Transaction-level payment ledger.
//
// `Subscription` holds the CURRENT entitlement; this holds what the customer was
// actually charged. The two are deliberately separate writers: subscription
// events own the `Organization.plan` entitlement mirror, payment events never
// touch it. Two writers on one gate field is how a customer loses access to a
// product they have paid for.
//
// Event names and field paths here were verified against Paddle Billing's
// webhook reference (developer.paddle.com/webhooks), not inferred. Two things
// that reference contradicts a reasonable guess about, and that are easy to get
// wrong:
//   1. There is no `transaction.refunded`, `transaction.partially_refunded` or
//      `transaction.disputed`. Refunds and chargebacks arrive as
//      `adjustment.created` / `adjustment.updated`, carrying `action`
//      (refund | chargeback | chargeback_reverse | chargeback_warning | credit |
//      credit_reverse), `type` (full | partial) and a `transaction_id` pointing
//      back at the transaction they adjust.
//   2. Money lives at `data.details.totals.*` as STRINGS in minor units, not as
//      numbers at the top level.
import { Types } from "mongoose";
import { Organization, Payment, Subscription } from "../models/index.js";
import { logger } from "../config/logger.js";
import {
  orgBillingRecipientEmails,
  sendSubscriptionReceipt,
} from "./subscription-receipt.service.js";

export type PaymentStatus =
  | "pending"
  | "completed"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "disputed";

// Terminality order. Used only to break ties when two events carry the same
// `occurred_at` (or none at all); the timestamp is the primary authority.
// `failed` sits below `completed` on purpose: a retried card that finally
// succeeds keeps the same transaction id, so failed -> completed is a real
// forward transition, while completed -> failed for one transaction is not.
const STATUS_RANK: Record<PaymentStatus, number> = {
  pending: 0,
  failed: 1,
  completed: 2,
  partially_refunded: 3,
  refunded: 4,
  disputed: 5,
};

export type PaddleWebhookEvent = {
  event_id?: string;
  event_type: string;
  occurred_at?: string;
  notification_id?: string;
  // Shapes differ per family; each handler narrows what it reads.
  data: Record<string, unknown>;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

// Paddle sends money as a string of minor units ("1250" = $12.50). Anything we
// cannot read as an integer becomes undefined rather than 0, because a silent
// zero in a billing history is indistinguishable from a free month.
function minorUnits(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return undefined;
}

function date(v: unknown): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Map a transaction event onto our ledger status. Returns null for the states
// that are not a payment at all (a draft or ready transaction is a quote, and a
// canceled one never took money), so they leave no row behind.
export function statusFromTransaction(
  eventType: string,
  transactionStatus: string | undefined,
): PaymentStatus | null {
  if (eventType === "transaction.payment_failed") return "failed";
  switch (transactionStatus) {
    case "paid":
    case "completed":
      return "completed";
    case "billed":
      return "pending";
    case "past_due":
      return "failed";
    default:
      return null;
  }
}

// Map an adjustment onto the status it implies for the transaction it adjusts.
// `credit` and `credit_reverse` move money on Paddle's side without changing
// whether this charge stands, so they record nothing here.
export function statusFromAdjustment(
  action: string | undefined,
  type: string | undefined,
): PaymentStatus | null {
  switch (action) {
    case "refund":
      return type === "partial" ? "partially_refunded" : "refunded";
    case "chargeback":
    case "chargeback_warning":
      return "disputed";
    case "chargeback_reverse":
      // We won the dispute: the charge stands again.
      return "completed";
    default:
      return null;
  }
}

/**
 * Decide whether an incoming event may move an existing row's status.
 *
 * Paddle retries and can deliver out of order, so "the last write wins" is
 * wrong: a replayed `transaction.updated` must not drag a completed payment
 * back to pending. The event's own `occurred_at` is authoritative; rank only
 * breaks ties.
 */
export function isNewerEvent(args: {
  incomingOccurredAt?: Date;
  storedOccurredAt?: Date | null;
  incomingStatus: PaymentStatus;
  storedStatus?: PaymentStatus | null;
}): boolean {
  const { incomingOccurredAt, storedOccurredAt, incomingStatus, storedStatus } = args;
  if (!storedStatus) return true;
  if (incomingOccurredAt && storedOccurredAt) {
    if (incomingOccurredAt.getTime() > storedOccurredAt.getTime()) return true;
    if (incomingOccurredAt.getTime() < storedOccurredAt.getTime()) return false;
  }
  return STATUS_RANK[incomingStatus] >= STATUS_RANK[storedStatus];
}

async function resolveOrganizationId(args: {
  customData: Record<string, unknown> | undefined;
  subscriptionId?: string;
  transactionId?: string;
}): Promise<string | null> {
  const fromCustomData = str(args.customData?.organizationId);
  if (fromCustomData) return fromCustomData;
  // Paddle only echoes custom_data on transactions created through a checkout
  // that set it. Renewals often arrive without it, so fall back to the
  // subscription we already know about.
  if (args.subscriptionId) {
    const sub = await Subscription.findOne({ paddleSubscriptionId: args.subscriptionId })
      .select("organizationId")
      .lean();
    if (sub) return String(sub.organizationId);
  }
  if (args.transactionId) {
    const existing = await Payment.findOne({ providerTransactionId: args.transactionId })
      .select("organizationId")
      .lean();
    if (existing) return String(existing.organizationId);
  }
  return null;
}

/**
 * Apply one `transaction.*` event to the payment ledger.
 *
 * Idempotent by construction: every write upserts on `providerTransactionId`,
 * so a redelivered event converges on the same single row. The caller
 * (`handlePaddleEvent`) has already consumed the event-id idempotency guard, so
 * in practice a true duplicate never reaches here; this stays safe anyway
 * because the reconcile and backfill paths deliberately bypass that guard.
 */
export async function applyTransactionEvent(event: PaddleWebhookEvent): Promise<void> {
  const data = event.data;
  const transactionId = str(data.id);
  if (!transactionId) {
    logger.warn("[payment] transaction event without an id", { eventType: event.event_type });
    return;
  }

  const status = statusFromTransaction(event.event_type, str(data.status));
  if (!status) {
    logger.debug("[payment] transaction event carries no payment state", {
      eventType: event.event_type,
      transactionStatus: str(data.status),
      transactionId,
    });
    return;
  }

  const subscriptionPaddleId = str(data.subscription_id);
  const organizationId = await resolveOrganizationId({
    customData: obj(data.custom_data),
    subscriptionId: subscriptionPaddleId,
    transactionId,
  });
  if (!organizationId) {
    logger.warn("[payment] could not resolve organization for transaction", {
      transactionId,
      subscriptionId: subscriptionPaddleId,
    });
    return;
  }

  const sub = subscriptionPaddleId
    ? await Subscription.findOne({ paddleSubscriptionId: subscriptionPaddleId })
        .select("_id status")
        .lean()
    : await Subscription.findOne({ organizationId }).select("_id status").lean();

  const occurredAt =
    date(event.occurred_at) ?? date(data.billed_at) ?? date(data.created_at) ?? new Date();

  const existing = await Payment.findOne({ providerTransactionId: transactionId })
    .select("status lastEventOccurredAt")
    .lean();

  const totals = obj(obj(data.details)?.totals);
  const firstPayment = Array.isArray(data.payments)
    ? obj((data.payments as unknown[])[0])
    : undefined;
  const card = obj(obj(firstPayment?.method_details)?.card);

  // Everything that is safe to refresh on any delivery: these describe the
  // transaction, not its outcome, so a stale event cannot corrupt them.
  const facts = {
    organizationId: new Types.ObjectId(organizationId),
    subscriptionId: sub?._id,
    provider: "paddle" as const,
    providerTransactionId: transactionId,
    providerInvoiceId: str(data.invoice_id) ?? str(data.invoice_number),
    // Paddle Billing does not put a receipt or invoice URL on the transaction
    // payload, and the one its API mints expires after an hour, so it must not
    // be cached here. These stay for providers that do send one inline; for
    // Paddle the UI asks for a fresh link on demand (see `invoiceUrlFor`).
    invoiceUrl: str(data.invoice_url),
    receiptUrl: str(data.receipt_url),
    amount: minorUnits(totals?.grand_total) ?? minorUnits(totals?.total) ?? 0,
    currency: str(data.currency_code) ?? "USD",
    tax: minorUnits(totals?.tax),
    discount: minorUnits(totals?.discount),
    billingPeriod: {
      start: date(obj(data.billing_period)?.starts_at),
      end: date(obj(data.billing_period)?.ends_at),
    },
    paymentMethod: {
      type: str(obj(firstPayment?.method_details)?.type),
      last4: str(card?.last4),
      brand: str(card?.type),
    },
    occurredAt,
    rawPayload: event,
  };

  const stale = !isNewerEvent({
    incomingOccurredAt: occurredAt,
    storedOccurredAt: existing?.lastEventOccurredAt ?? undefined,
    incomingStatus: status,
    storedStatus: (existing?.status as PaymentStatus | undefined) ?? undefined,
  });

  if (stale) {
    // Out-of-order delivery. Keep the newer outcome, but let the older event
    // fill in anything we are still missing (Paddle sometimes populates the
    // invoice id or card details only on the later-numbered event).
    logger.info("[payment] ignoring out-of-order transaction event", {
      transactionId,
      eventType: event.event_type,
      incomingStatus: status,
      storedStatus: existing?.status,
    });
    await Payment.updateOne(
      { providerTransactionId: transactionId },
      {
        $set: Object.fromEntries(
          Object.entries({
            providerInvoiceId: facts.providerInvoiceId,
            "paymentMethod.last4": facts.paymentMethod.last4,
            "paymentMethod.brand": facts.paymentMethod.brand,
            "paymentMethod.type": facts.paymentMethod.type,
          }).filter(([, v]) => v !== undefined),
        ),
      },
    );
    return;
  }

  const priorStatus = existing?.status as PaymentStatus | undefined;

  await Payment.findOneAndUpdate(
    { providerTransactionId: transactionId },
    {
      $set: {
        ...facts,
        status,
        failureReason:
          status === "failed" ? str(firstPayment?.error_code) ?? "unknown" : undefined,
        lastEventType: event.event_type,
        lastEventOccurredAt: occurredAt,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await reconcileDunningState({
    organizationId,
    status,
    priorStatus,
    subscriptionStatus: sub?.status,
    amount: facts.amount,
    currency: facts.currency,
  });
}

/**
 * Apply one `adjustment.*` event: a refund, a chargeback, or a chargeback
 * reversal, each of which changes the standing of a transaction we should
 * already have a row for.
 */
export async function applyAdjustmentEvent(
  event: PaddleWebhookEvent,
  fetchTransaction?: (transactionId: string) => Promise<PaddleWebhookEvent["data"] | null>,
): Promise<void> {
  const data = event.data;
  const transactionId = str(data.transaction_id);
  if (!transactionId) {
    logger.warn("[payment] adjustment without transaction_id", { eventType: event.event_type });
    return;
  }

  // Paddle approves adjustments asynchronously. A pending or rejected one has
  // not moved any money, so it must not change what the customer sees.
  const adjustmentStatus = str(data.status);
  if (adjustmentStatus && adjustmentStatus !== "approved") {
    logger.info("[payment] adjustment not approved, no ledger change", {
      transactionId,
      adjustmentStatus,
      action: str(data.action),
    });
    return;
  }

  const status = statusFromAdjustment(str(data.action), str(data.type));
  if (!status) {
    logger.debug("[payment] adjustment action does not change payment standing", {
      transactionId,
      action: str(data.action),
    });
    return;
  }

  let payment = await Payment.findOne({ providerTransactionId: transactionId })
    .select("status lastEventOccurredAt organizationId")
    .lean();

  if (!payment && fetchTransaction) {
    // The adjustment beat its transaction here. Rather than invent a row from
    // the refund amount (which would show the wrong figure in billing history
    // forever), pull the real transaction and build the row properly.
    try {
      const txn = await fetchTransaction(transactionId);
      if (txn) {
        await applyTransactionEvent({
          event_type: "transaction.completed",
          occurred_at: str(txn.billed_at) ?? str(txn.created_at),
          data: txn,
        });
        payment = await Payment.findOne({ providerTransactionId: transactionId })
          .select("status lastEventOccurredAt organizationId")
          .lean();
      }
    } catch (err) {
      logger.warn("[payment] could not backfill transaction for adjustment", {
        transactionId,
        err: (err as Error).message,
      });
    }
  }

  if (!payment) {
    logger.warn("[payment] adjustment for an unknown transaction, skipped", {
      transactionId,
      action: str(data.action),
    });
    return;
  }

  const occurredAt = date(event.occurred_at) ?? date(data.created_at) ?? new Date();

  // A chargeback outranks a refund, and a reversal is newer than both. The rank
  // check inside isNewerEvent handles same-timestamp collisions; the timestamp
  // handles everything else.
  if (
    !isNewerEvent({
      incomingOccurredAt: occurredAt,
      storedOccurredAt: payment.lastEventOccurredAt ?? undefined,
      incomingStatus: status,
      storedStatus: payment.status as PaymentStatus,
    })
  ) {
    logger.info("[payment] ignoring out-of-order adjustment", {
      transactionId,
      incomingStatus: status,
      storedStatus: payment.status,
    });
    return;
  }

  const totals = obj(data.totals);
  await Payment.updateOne(
    { providerTransactionId: transactionId },
    {
      $set: {
        status,
        failureReason: status === "disputed" ? str(data.reason) ?? "chargeback" : undefined,
        lastEventType: event.event_type,
        lastEventOccurredAt: occurredAt,
        // The adjustment payload is evidence in its own right for a dispute, so
        // it is kept beside the transaction payload rather than replacing it.
        adjustment: {
          id: str(data.id),
          action: str(data.action),
          type: str(data.type),
          reason: str(data.reason),
          amount: minorUnits(totals?.total),
          occurredAt,
          raw: event,
        },
      },
    },
  );

  logger.info("[payment] adjustment applied", {
    transactionId,
    action: str(data.action),
    status,
  });
}

/**
 * Keep the dunning state in step with the latest payment outcome.
 *
 * This writes `Subscription.status` only. It deliberately does NOT touch
 * `Organization.plan`: subscription events own that mirror, and a failed
 * payment should raise a banner, not revoke access while the provider is still
 * retrying the card.
 */
async function reconcileDunningState(args: {
  organizationId: string;
  status: PaymentStatus;
  priorStatus?: PaymentStatus;
  subscriptionStatus?: string;
  amount: number;
  currency: string;
}): Promise<void> {
  const { organizationId, status, priorStatus, subscriptionStatus } = args;

  if (status === "failed") {
    if (subscriptionStatus === "canceled") return; // nothing to dun
    const res = await Subscription.updateOne(
      { organizationId, status: { $nin: ["past_due", "canceled"] } },
      { $set: { status: "past_due" } },
    );
    if (res.modifiedCount > 0) {
      logger.warn("[payment] subscription marked past_due after failed payment", {
        organizationId,
      });
      void notifyPaymentFailed(args).catch((err) =>
        logger.warn("[payment] payment-failed email failed", {
          organizationId,
          err: String(err),
        }),
      );
    }
    return;
  }

  if (status === "completed" && (subscriptionStatus === "past_due" || priorStatus === "failed")) {
    const res = await Subscription.updateOne(
      { organizationId, status: "past_due" },
      { $set: { status: "active" } },
    );
    if (res.modifiedCount > 0) {
      logger.info("[payment] subscription recovered from past_due", { organizationId });
    }
  }
}

// Fire-and-forget: mail must never hold up a webhook 200. Paddle retries on a
// non-2xx, and our event-id guard would swallow the retry, so a slow mailer
// would cost us the payment record itself.
async function notifyPaymentFailed(args: {
  organizationId: string;
  amount: number;
  currency: string;
}): Promise<void> {
  const emails = await orgBillingRecipientEmails(args.organizationId);
  if (emails.length === 0) return;
  const org = await Organization.findById(args.organizationId).select("plan").lean();
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? "Platform";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  await sendSubscriptionReceipt({
    to: emails,
    action: "payment_failed",
    planName: org?.plan ? String(org.plan) : "your plan",
    // Minor units back to major for display only.
    amount: args.amount ? args.amount / 100 : null,
    currency: args.currency,
    appName,
    brandName: appName,
    billingUrl: appUrl ? `${appUrl}/app/billing` : null,
  });
}

export type PaymentListItem = {
  id: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  tax: number | null;
  description: string;
  occurredAt: string;
  invoiceUrl: string | null;
  receiptUrl: string | null;
  hasInvoice: boolean;
  providerTransactionId: string;
  failureReason: string | null;
  paymentMethod: { type: string | null; last4: string | null; brand: string | null };
};

export async function listPayments(args: {
  organizationId: string;
  limit?: number;
}): Promise<PaymentListItem[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const rows = await Payment.find({ organizationId: args.organizationId })
    .sort({ occurredAt: -1 })
    .limit(limit)
    .lean();

  return rows.map((r) => {
    const start = r.billingPeriod?.start;
    const end = r.billingPeriod?.end;
    const period =
      start && end
        ? `${new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${new Date(end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
        : null;
    return {
      id: String(r._id),
      status: r.status as PaymentStatus,
      amount: r.amount ?? 0,
      currency: r.currency ?? "USD",
      tax: r.tax ?? null,
      description: period ? `Subscription ${period}` : "Subscription",
      occurredAt: new Date(r.occurredAt).toISOString(),
      invoiceUrl: r.invoiceUrl ?? null,
      receiptUrl: r.receiptUrl ?? null,
      // Whether a document can be minted at all. Paddle issues one for any
      // transaction that reached billed; a failed or still-pending charge has
      // no invoice, so the UI must not offer a link that would 404.
      hasInvoice: r.status !== "failed" && r.status !== "pending",
      providerTransactionId: r.providerTransactionId,
      failureReason: r.failureReason ?? null,
      paymentMethod: {
        type: r.paymentMethod?.type ?? null,
        last4: r.paymentMethod?.last4 ?? null,
        brand: r.paymentMethod?.brand ?? null,
      },
    };
  });
}

// Latest payment for the org, used by the checkout pending page so a failed
// card shows as failed instead of spinning until the poll gives up.
export async function latestPayment(organizationId: string): Promise<PaymentListItem | null> {
  const [row] = await listPayments({ organizationId, limit: 1 });
  return row ?? null;
}
