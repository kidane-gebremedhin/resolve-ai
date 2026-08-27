// Payment ledger: transaction and adjustment webhooks.
//
// The tests that actually pin the design down are the idempotency one and the
// out-of-order one. A handler that books a row per delivery passes everything
// else in this file and still double-charges the billing history the first time
// Paddle retries, which it does routinely.
//
// Event names and payload shapes here mirror Paddle Billing's webhook reference:
// money is a STRING of minor units under `data.details.totals`, refunds and
// chargebacks arrive as `adjustment.*` (there is no `transaction.refunded`), and
// the card lives at `data.payments[].method_details.card`.

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import mongoose from "mongoose";
import { createApp } from "../test/app.js";

// A mailer that throws is the realistic failure: SMTP is down, or the provider
// rate-limits us. Paddle reads a non-2xx as "retry later", and our event-id
// guard would swallow that retry, so a mail failure that propagates costs us
// the payment record permanently. Every test in this file runs against a
// mailer that throws, which means the whole suite doubles as proof that no
// path here depends on mail succeeding.
const sendMailMock = vi.fn(async () => {
  throw new Error("smtp is down");
});
vi.mock("../services/mailer.service.js", () => ({
  sendMail: (...args: unknown[]) => sendMailMock(...(args as [])),
  __esModule: true,
}));
import { Membership, Organization, Payment, Subscription, User } from "../models/index.js";
import { handlePaddleEvent } from "../services/billing.service.js";
import {
  applyAdjustmentEvent,
  isNewerEvent,
  listPayments,
  statusFromAdjustment,
  statusFromTransaction,
} from "../services/payment.service.js";

const PADDLE_SUB_ID = "sub_01hx000000000000000000";
const TXN_ID = "txn_01hx000000000000000001";

let orgId: string;
let subId: mongoose.Types.ObjectId;
let eventSeq = 0;

function eventId(): string {
  eventSeq += 1;
  return `evt_${String(eventSeq).padStart(24, "0")}`;
}

async function seedOrgWithSubscription(status = "active"): Promise<void> {
  const org = await Organization.create({ name: "Acme", slug: `acme-${Date.now()}`, plan: "pro" });
  orgId = String(org._id);
  // An owner has to exist for the dunning notice to have anywhere to go.
  const owner = await User.create({
    email: `owner-${Date.now()}-${eventSeq}@example.com`,
    name: "Owner",
    provider: "credentials",
    passwordHash: "x",
  });
  await Membership.create({
    organizationId: org._id,
    userId: owner._id,
    role: "owner",
    status: "active",
  });
  const sub = await Subscription.create({
    organizationId: org._id,
    paddleSubscriptionId: PADDLE_SUB_ID,
    paddleCustomerId: "ctm_01hx",
    source: "paddle",
    plan: "pro",
    status,
    currentPeriodStart: new Date("2026-08-01"),
    currentPeriodEnd: new Date("2026-09-01"),
  });
  subId = sub._id as mongoose.Types.ObjectId;
}

/** A Paddle transaction webhook, shaped the way Paddle actually sends one. */
function transactionEvent(
  eventType: string,
  overrides: {
    status?: string;
    occurredAt?: string;
    grandTotal?: string;
    errorCode?: string;
    transactionId?: string;
    customData?: Record<string, string> | null;
  } = {},
) {
  return {
    event_id: eventId(),
    event_type: eventType,
    occurred_at: overrides.occurredAt ?? "2026-08-15T10:00:00Z",
    data: {
      id: overrides.transactionId ?? TXN_ID,
      status: overrides.status ?? "completed",
      customer_id: "ctm_01hx",
      subscription_id: PADDLE_SUB_ID,
      invoice_id: "inv_01hx",
      currency_code: "USD",
      billing_period: { starts_at: "2026-08-01T00:00:00Z", ends_at: "2026-09-01T00:00:00Z" },
      custom_data: overrides.customData === null ? undefined : (overrides.customData ?? { organizationId: orgId }),
      details: {
        totals: {
          subtotal: "5000",
          tax: "1000",
          discount: "0",
          grand_total: overrides.grandTotal ?? "6000",
        },
      },
      payments: [
        {
          error_code: overrides.errorCode,
          method_details: { type: "card", card: { type: "visa", last4: "4242" } },
        },
      ],
      created_at: "2026-08-15T09:59:00Z",
      billed_at: "2026-08-15T10:00:00Z",
    },
  };
}

function adjustmentEvent(
  action: string,
  opts: { type?: string; status?: string; occurredAt?: string; total?: string } = {},
) {
  return {
    event_id: eventId(),
    event_type: "adjustment.created",
    occurred_at: opts.occurredAt ?? "2026-08-20T10:00:00Z",
    data: {
      id: "adj_01hx",
      action,
      type: opts.type ?? "full",
      status: opts.status ?? "approved",
      transaction_id: TXN_ID,
      subscription_id: PADDLE_SUB_ID,
      customer_id: "ctm_01hx",
      reason: "customer request",
      currency_code: "USD",
      totals: { subtotal: "5000", tax: "1000", total: opts.total ?? "6000" },
      created_at: "2026-08-20T10:00:00Z",
    },
  };
}

describe("payment ledger", () => {
  beforeEach(async () => {
    eventSeq = 0;
    await seedOrgWithSubscription();
  });

  // The HTTP layer, not just the handler. This exists because the route was
  // broken for its entire life in a way no handler-level test could see: it
  // mounted its own `express.raw()` behind the global `express.json()`, so
  // body-parser skipped it, `req.body` was never a Buffer, and the signature
  // was always computed over an empty string. Every real delivery got a 401.
  // Testing `handlePaddleEvent` directly sails straight past that.
  describe("webhook route", () => {
    const SECRET = "pdl_ntfset_test_secret_value_for_signing";
    let app: Express;

    function sign(body: string): string {
      const ts = String(Math.floor(Date.now() / 1000));
      const h1 = crypto
        .createHmac("sha256", SECRET)
        .update(`${ts}:${body}`)
        .digest("hex");
      return `ts=${ts};h1=${h1}`;
    }

    beforeAll(() => {
      process.env.PADDLE_WEBHOOK_SECRET = SECRET;
      app = createApp();
    });

    it("accepts a correctly signed delivery and writes the ledger row", async () => {
      const body = JSON.stringify(transactionEvent("transaction.completed"));

      await request(app)
        .post("/api/v1/billing/webhook")
        .set("content-type", "application/json")
        .set("paddle-signature", sign(body))
        .send(body)
        .expect(204);

      const row = await Payment.findOne({ providerTransactionId: TXN_ID }).lean();
      expect(row?.status).toBe("completed");
      expect(row?.amount).toBe(6000);
    });

    it("rejects a bad signature without touching the ledger", async () => {
      const body = JSON.stringify(transactionEvent("transaction.completed"));

      await request(app)
        .post("/api/v1/billing/webhook")
        .set("content-type", "application/json")
        .set("paddle-signature", `ts=1;h1=${"0".repeat(64)}`)
        .send(body)
        .expect(401);

      expect(await Payment.countDocuments({})).toBe(0);
    });

    it("rejects a delivery with no signature header at all", async () => {
      const body = JSON.stringify(transactionEvent("transaction.completed"));

      await request(app)
        .post("/api/v1/billing/webhook")
        .set("content-type", "application/json")
        .send(body)
        .expect(401);

      expect(await Payment.countDocuments({})).toBe(0);
    });

    it("is a no-op on a redelivered event, over HTTP", async () => {
      const body = JSON.stringify(transactionEvent("transaction.completed"));
      const sig = sign(body);

      for (const _ of [1, 2]) {
        await request(app)
          .post("/api/v1/billing/webhook")
          .set("content-type", "application/json")
          .set("paddle-signature", sig)
          .send(body)
          .expect(204);
      }

      expect(await Payment.countDocuments({ providerTransactionId: TXN_ID })).toBe(1);
    });
  });

  describe("status mapping", () => {
    it("maps each transaction state to a ledger status", () => {
      expect(statusFromTransaction("transaction.completed", "completed")).toBe("completed");
      expect(statusFromTransaction("transaction.paid", "paid")).toBe("completed");
      expect(statusFromTransaction("transaction.billed", "billed")).toBe("pending");
      expect(statusFromTransaction("transaction.past_due", "past_due")).toBe("failed");
      expect(statusFromTransaction("transaction.payment_failed", "billed")).toBe("failed");
    });

    it("records nothing for a transaction that never took money", () => {
      // A draft or ready transaction is a quote, and a canceled one never
      // charged anyone. None of them belong in a billing history.
      expect(statusFromTransaction("transaction.created", "draft")).toBeNull();
      expect(statusFromTransaction("transaction.updated", "ready")).toBeNull();
      expect(statusFromTransaction("transaction.canceled", "canceled")).toBeNull();
    });

    it("maps adjustment actions, and ignores the ones that do not change standing", () => {
      expect(statusFromAdjustment("refund", "full")).toBe("refunded");
      expect(statusFromAdjustment("refund", "partial")).toBe("partially_refunded");
      expect(statusFromAdjustment("chargeback", "full")).toBe("disputed");
      expect(statusFromAdjustment("chargeback_warning", "full")).toBe("disputed");
      expect(statusFromAdjustment("chargeback_reverse", "full")).toBe("completed");
      expect(statusFromAdjustment("credit", "partial")).toBeNull();
      expect(statusFromAdjustment("credit_reverse", "full")).toBeNull();
    });
  });

  describe("event ordering", () => {
    it("prefers the newer event by timestamp, whichever status it carries", () => {
      const older = new Date("2026-08-15T10:00:00Z");
      const newer = new Date("2026-08-15T11:00:00Z");
      expect(
        isNewerEvent({
          incomingOccurredAt: newer,
          storedOccurredAt: older,
          incomingStatus: "pending",
          storedStatus: "completed",
        }),
      ).toBe(true);
      expect(
        isNewerEvent({
          incomingOccurredAt: older,
          storedOccurredAt: newer,
          incomingStatus: "completed",
          storedStatus: "pending",
        }),
      ).toBe(false);
    });

    it("falls back to terminality when two events share a timestamp", () => {
      const t = new Date("2026-08-15T10:00:00Z");
      expect(
        isNewerEvent({
          incomingOccurredAt: t,
          storedOccurredAt: t,
          incomingStatus: "pending",
          storedStatus: "completed",
        }),
      ).toBe(false);
      // A retried card that finally clears keeps the same transaction id, so
      // failed -> completed has to remain a legal forward move.
      expect(
        isNewerEvent({
          incomingOccurredAt: t,
          storedOccurredAt: t,
          incomingStatus: "completed",
          storedStatus: "failed",
        }),
      ).toBe(true);
    });
  });

  describe("transaction webhooks", () => {
    it("books one row per transaction with money read from details.totals", async () => {
      await handlePaddleEvent(transactionEvent("transaction.completed"));

      const rows = await Payment.find({ organizationId: orgId }).lean();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.providerTransactionId).toBe(TXN_ID);
      expect(row.status).toBe("completed");
      // Minor units, parsed from Paddle's string, not coerced to a float.
      expect(row.amount).toBe(6000);
      expect(row.tax).toBe(1000);
      expect(row.currency).toBe("USD");
      expect(row.paymentMethod?.last4).toBe("4242");
      expect(row.paymentMethod?.brand).toBe("visa");
      expect(String(row.subscriptionId)).toBe(String(subId));
      // The whole event is kept for dispute resolution, not a trimmed copy.
      expect(row.rawPayload).toBeTruthy();
    });

    it("is a no-op on duplicate delivery", async () => {
      const event = transactionEvent("transaction.completed");
      await handlePaddleEvent(event);
      await handlePaddleEvent(event); // Paddle retries the identical event

      expect(await Payment.countDocuments({ providerTransactionId: TXN_ID })).toBe(1);
    });

    it("keeps the newer outcome when a stale event arrives late", async () => {
      // completed lands first, then a replayed `updated` from earlier in the
      // transaction's life shows up. Last-write-wins would drag a paid invoice
      // back to pending in the customer's billing history.
      await handlePaddleEvent(
        transactionEvent("transaction.completed", {
          status: "completed",
          occurredAt: "2026-08-15T12:00:00Z",
        }),
      );
      await handlePaddleEvent(
        transactionEvent("transaction.updated", {
          status: "billed",
          occurredAt: "2026-08-15T10:00:00Z",
        }),
      );

      const row = await Payment.findOne({ providerTransactionId: TXN_ID }).lean();
      expect(row?.status).toBe("completed");
      expect(await Payment.countDocuments({ providerTransactionId: TXN_ID })).toBe(1);
    });

    it("moves forward when the events arrive in order", async () => {
      await handlePaddleEvent(
        transactionEvent("transaction.billed", {
          status: "billed",
          occurredAt: "2026-08-15T10:00:00Z",
        }),
      );
      expect((await Payment.findOne({ providerTransactionId: TXN_ID }).lean())?.status).toBe(
        "pending",
      );

      await handlePaddleEvent(
        transactionEvent("transaction.completed", {
          status: "completed",
          occurredAt: "2026-08-15T12:00:00Z",
        }),
      );
      expect((await Payment.findOne({ providerTransactionId: TXN_ID }).lean())?.status).toBe(
        "completed",
      );
    });

    it("resolves the organization from the subscription when custom_data is absent", async () => {
      // Renewals do not echo the checkout's custom_data, so an implementation
      // that only reads custom_data silently drops every renewal.
      await handlePaddleEvent(transactionEvent("transaction.completed", { customData: null }));

      const row = await Payment.findOne({ providerTransactionId: TXN_ID }).lean();
      expect(row).toBeTruthy();
      expect(String(row?.organizationId)).toBe(orgId);
    });

    it("ignores an event family it does not handle", async () => {
      await handlePaddleEvent({
        event_id: eventId(),
        event_type: "customer.updated",
        data: { id: "ctm_01hx" },
      } as never);
      expect(await Payment.countDocuments({})).toBe(0);
    });
  });

  describe("dunning", () => {
    it("marks the subscription past due on a failed payment", async () => {
      await handlePaddleEvent(
        transactionEvent("transaction.payment_failed", {
          status: "billed",
          errorCode: "insufficient_funds",
        }),
      );

      const sub = await Subscription.findById(subId).lean();
      expect(sub?.status).toBe("past_due");
      const row = await Payment.findOne({ providerTransactionId: TXN_ID }).lean();
      expect(row?.status).toBe("failed");
      expect(row?.failureReason).toBe("insufficient_funds");
    });

    it("clears past due when a later payment succeeds", async () => {
      await handlePaddleEvent(
        transactionEvent("transaction.payment_failed", {
          status: "billed",
          errorCode: "card_declined",
          occurredAt: "2026-08-15T10:00:00Z",
        }),
      );
      expect((await Subscription.findById(subId).lean())?.status).toBe("past_due");

      await handlePaddleEvent(
        transactionEvent("transaction.completed", {
          status: "completed",
          occurredAt: "2026-08-16T10:00:00Z",
        }),
      );
      expect((await Subscription.findById(subId).lean())?.status).toBe("active");
    });

    it("leaves the entitlement mirror alone", async () => {
      // Payment events raise a banner; they do not revoke access while the
      // provider is still retrying the card. Only subscription events own
      // `Organization.plan`.
      await handlePaddleEvent(
        transactionEvent("transaction.payment_failed", { status: "billed" }),
      );
      const org = await Organization.findById(orgId).lean();
      expect(org?.plan).toBe("pro");
    });

    it("still books the payment when the mailer throws", async () => {
      sendMailMock.mockClear();

      await expect(
        handlePaddleEvent(
          transactionEvent("transaction.payment_failed", {
            status: "billed",
            errorCode: "card_declined",
          }),
        ),
      ).resolves.toBeUndefined();

      // The webhook completed, so the route returns its 204 and Paddle does not
      // retry. The ledger row and the dunning state both survived the failure.
      const row = await Payment.findOne({ providerTransactionId: TXN_ID }).lean();
      expect(row?.status).toBe("failed");
      expect((await Subscription.findById(subId).lean())?.status).toBe("past_due");

      // The mail path is fire-and-forget and does three database reads before it
      // reaches the mailer, so a fixed sleep here is a flake waiting for a
      // loaded CI box. Poll instead, and assert it was actually attempted:
      // "never called" and "called and absorbed" are different outcomes, and
      // only the second one proves the throw was handled.
      await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalled(), {
        timeout: 5_000,
        interval: 25,
      });
    });

    it("does not dun a canceled subscription", async () => {
      await Subscription.updateOne({ _id: subId }, { $set: { status: "canceled" } });
      await handlePaddleEvent(
        transactionEvent("transaction.payment_failed", { status: "billed" }),
      );
      expect((await Subscription.findById(subId).lean())?.status).toBe("canceled");
    });
  });

  describe("adjustments", () => {
    beforeEach(async () => {
      await handlePaddleEvent(
        transactionEvent("transaction.completed", { occurredAt: "2026-08-15T10:00:00Z" }),
      );
    });

    it("records a full refund against the original transaction", async () => {
      await handlePaddleEvent(adjustmentEvent("refund", { type: "full" }));

      const row = await Payment.findOne({ providerTransactionId: TXN_ID }).lean();
      expect(row?.status).toBe("refunded");
      expect(row?.adjustment?.action).toBe("refund");
      expect(row?.adjustment?.amount).toBe(6000);
      // The original charge is still on record; the refund did not overwrite it.
      expect(row?.amount).toBe(6000);
      expect(await Payment.countDocuments({})).toBe(1);
    });

    it("records a partial refund distinctly", async () => {
      await handlePaddleEvent(adjustmentEvent("refund", { type: "partial", total: "2000" }));

      const row = await Payment.findOne({ providerTransactionId: TXN_ID }).lean();
      expect(row?.status).toBe("partially_refunded");
      expect(row?.adjustment?.amount).toBe(2000);
    });

    it("records a chargeback, and its reversal", async () => {
      await handlePaddleEvent(
        adjustmentEvent("chargeback", { occurredAt: "2026-08-20T10:00:00Z" }),
      );
      expect((await Payment.findOne({ providerTransactionId: TXN_ID }).lean())?.status).toBe(
        "disputed",
      );

      await handlePaddleEvent(
        adjustmentEvent("chargeback_reverse", { occurredAt: "2026-08-25T10:00:00Z" }),
      );
      expect((await Payment.findOne({ providerTransactionId: TXN_ID }).lean())?.status).toBe(
        "completed",
      );
    });

    it("ignores an adjustment that has not been approved", async () => {
      await handlePaddleEvent(adjustmentEvent("refund", { status: "pending_approval" }));
      expect((await Payment.findOne({ providerTransactionId: TXN_ID }).lean())?.status).toBe(
        "completed",
      );
    });

    it("builds the row from the real transaction when the adjustment arrives first", async () => {
      await Payment.deleteMany({});
      const fetchTransaction = vi.fn().mockResolvedValue(
        transactionEvent("transaction.completed").data,
      );

      await applyAdjustmentEvent(adjustmentEvent("refund", { type: "full" }), fetchTransaction);

      expect(fetchTransaction).toHaveBeenCalledWith(TXN_ID);
      const row = await Payment.findOne({ providerTransactionId: TXN_ID }).lean();
      // The row shows the original charge with a refunded status, not the
      // refund amount masquerading as the charge.
      expect(row?.amount).toBe(6000);
      expect(row?.status).toBe("refunded");
    });

    it("skips an adjustment for a transaction it cannot resolve", async () => {
      await Payment.deleteMany({});
      const fetchTransaction = vi.fn().mockResolvedValue(null);

      await applyAdjustmentEvent(adjustmentEvent("refund"), fetchTransaction);

      expect(await Payment.countDocuments({})).toBe(0);
    });
  });

  describe("billing history", () => {
    it("returns rows newest first, scoped to the organization", async () => {
      await handlePaddleEvent(
        transactionEvent("transaction.completed", {
          transactionId: "txn_older",
          occurredAt: "2026-07-15T10:00:00Z",
        }),
      );
      await handlePaddleEvent(
        transactionEvent("transaction.completed", {
          transactionId: "txn_newer",
          occurredAt: "2026-08-15T10:00:00Z",
        }),
      );

      const rows = await listPayments({ organizationId: orgId });
      expect(rows.map((r) => r.status)).toEqual(["completed", "completed"]);
      expect(new Date(rows[0]!.occurredAt).getTime()).toBeGreaterThan(
        new Date(rows[1]!.occurredAt).getTime(),
      );
      expect(rows[0]!.description).toContain("Subscription");
    });

    it("flags which rows can have an invoice minted", async () => {
      // Paddle issues no invoice for a charge that never billed, so the UI must
      // not offer a link that would 404 when clicked.
      await handlePaddleEvent(
        transactionEvent("transaction.completed", {
          transactionId: "txn_ok",
          occurredAt: "2026-08-15T10:00:00Z",
        }),
      );
      await handlePaddleEvent(
        transactionEvent("transaction.payment_failed", {
          transactionId: "txn_bad",
          status: "billed",
          occurredAt: "2026-08-16T10:00:00Z",
        }),
      );

      const rows = await listPayments({ organizationId: orgId });
      const byId = new Map(rows.map((r) => [r.providerTransactionId, r]));
      expect(byId.get("txn_ok")?.hasInvoice).toBe(true);
      expect(byId.get("txn_bad")?.hasInvoice).toBe(false);
      // Nothing is cached: Paddle's invoice links expire in an hour, so the row
      // must not pretend to hold one.
      expect(byId.get("txn_ok")?.receiptUrl).toBeNull();
      expect(byId.get("txn_ok")?.invoiceUrl).toBeNull();
    });

    it("is empty for an organization with no payments", async () => {
      const other = await Organization.create({ name: "Other", slug: `other-${Date.now()}` });
      expect(await listPayments({ organizationId: String(other._id) })).toEqual([]);
    });
  });
});
