import type { OAuthAppCreds, ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";
import { env } from "../../../config/env.js";

const OAUTH_BASE = "https://connect.stripe.com/oauth";
const API_BASE = "https://api.stripe.com/v1";
const API_TEST = "https://api.stripe.com/v1";

type BillingInterval = "month" | "year";

// The OPERATOR's own plan → price-id mapping, stored per-connection in
// credentials.extra.planPrices (configured via "Configure plans"). Identical shape to the
// Paddle adapter — the subscription tools act on the operator's OWN Stripe (their customers'
// subscriptions), never this platform's Stripe. Shape:
//   { pro: { monthly: "price_x", yearly: "price_y" }, business: {...}, ... }
type StripePlanPrices = Record<string, { monthly?: string; yearly?: string }>;

function readPlanPrices(credentials: RawCredentials): StripePlanPrices {
  const pp = (credentials.extra as { planPrices?: unknown } | undefined)?.planPrices;
  return pp && typeof pp === "object" ? (pp as StripePlanPrices) : {};
}
function priceForPlan(planPrices: StripePlanPrices, plan: string, interval: BillingInterval): string | undefined {
  return planPrices[plan]?.[interval === "year" ? "yearly" : "monthly"];
}
// price id → operator plan name (covers monthly AND yearly), so get_subscription can name
// the customer's current plan regardless of billing cycle.
function planForPriceId(planPrices: StripePlanPrices, priceId: string | undefined): string | undefined {
  if (!priceId) return undefined;
  return Object.entries(planPrices).find(([, ids]) => ids.monthly === priceId || ids.yearly === priceId)?.[0];
}

type StripeSub = {
  id: string;
  status?: string;
  itemId?: string; // si_… — needed to update the priced item on a plan change
  currentPriceId?: string;
  plan?: string;
  currentInterval: BillingInterval;
  currentQuantity: number;
  currentPeriodEnd?: number; // unix seconds
};

export class StripeAdapter implements ProviderAdapter {
  readonly provider = "stripe";

  buildAuthUrl(_orgId: string, state: string, app?: OAuthAppCreds | null): string {
    const clientId = app?.clientId;
    if (!clientId) return "";
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: app?.redirectUri ?? `${env.apiBaseUrl}/api/v1/integrations/stripe/callback`,
      response_type: "code",
      scope: "read_write",
      state,
    });
    return `${OAUTH_BASE}/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, _orgId: string, app?: OAuthAppCreds | null): Promise<RawCredentials> {
    // Stripe Connect uses the platform's SECRET KEY as the client_secret here.
    const res = await fetch(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_secret: app?.clientSecret ?? "",
        code,
        grant_type: "authorization_code",
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    // A failed exchange (bad/missing secret key, expired code) returns no access_token —
    // surface it rather than storing a tokenless "connected" integration.
    if (!res.ok || !data.access_token) {
      throw new Error(
        `Stripe token exchange failed: ${data.error_description ?? data.error ?? res.status}`,
      );
    }
    return { accessToken: data.access_token as string };
  }

  async refreshTokens(_blob: EncryptedBlob, _app?: OAuthAppCreds | null): Promise<RawCredentials | null> {
    return null;
  }

  getTools(): ToolTemplate[] {
    // Subscription tools are keyed off the customer's EMAIL and a human plan NAME — never
    // raw Stripe price ids. `email` is OPTIONAL: the widget already knows the visitor's
    // verified account email and the dispatcher injects it authoritatively (PII redaction
    // masks it from the model), so requiring it would just make the AI re-ask for something
    // the system already has. Mirrors the Paddle adapter.
    const planEnum = ["pro", "business", "enterprise"];
    const emailProp = {
      type: "string" as const,
      description: "The customer's account email. Optional — leave blank and the system uses their verified account email automatically.",
    };
    return [
      {
        key: "lookup_order",
        displayName: "Look Up Order",
        description: "Looks up a Stripe payment intent or charge by ID.",
        jsonSchema: {
          type: "object",
          properties: {
            orderId: { type: "string", description: "Stripe payment intent or charge ID (pi_... or ch_...)" },
          },
          required: ["orderId"],
        },
      },
      {
        key: "issue_refund",
        displayName: "Issue Refund",
        description: "Issues a refund for a Stripe charge. Requires identity verification for amounts above the guardrail cap.",
        jsonSchema: {
          type: "object",
          properties: {
            chargeId: { type: "string", description: "Stripe charge ID (ch_...)" },
            amount: { type: "number", description: "Refund amount in USD" },
            reason: { type: "string", enum: ["duplicate", "fraudulent", "requested_by_customer"] },
          },
          required: ["chargeId", "amount"],
        },
      },
      {
        key: "get_subscription",
        displayName: "Get Subscription",
        description: "Look up the customer's current subscription (plan, status, renewal). Uses their verified account email automatically — do NOT ask the customer for their email.",
        jsonSchema: { type: "object", properties: { email: emailProp }, required: [] },
      },
      {
        key: "upgrade_subscription",
        displayName: "Upgrade Subscription",
        description: "Upgrade the customer's subscription to a higher plan. Uses their verified account email automatically.",
        jsonSchema: {
          type: "object",
          properties: { email: emailProp, targetPlan: { type: "string", enum: planEnum, description: "Plan to move to" } },
          required: ["targetPlan"],
        },
      },
      {
        key: "downgrade_subscription",
        displayName: "Downgrade Subscription",
        description: "Downgrade the customer's subscription to a lower plan. Uses their verified account email automatically.",
        jsonSchema: {
          type: "object",
          properties: { email: emailProp, targetPlan: { type: "string", enum: planEnum, description: "Plan to move to" } },
          required: ["targetPlan"],
        },
      },
      {
        key: "cancel_subscription",
        displayName: "Cancel Subscription",
        description: "Cancel the customer's subscription at the end of the current billing period. Uses their verified account email automatically.",
        jsonSchema: { type: "object", properties: { email: emailProp }, required: [] },
      },
    ];
  }

  async execute(
    toolKey: string,
    args: Record<string, unknown>,
    credentials: RawCredentials,
    sandbox: boolean,
  ): Promise<unknown> {
    const base = sandbox ? API_TEST : API_BASE;
    // Works with EITHER auth style: an OAuth Connect access token (`accessToken`, from the
    // Connect flow) OR a plain secret key (`apiKey`, e.g. `sk_test_…`/a restricted key) when
    // the operator connected their own Stripe with a key instead of Connect. Stripe uses the
    // same HTTP Basic scheme (`<key>:`) for both, and the key's own mode (test vs live)
    // determines the environment — not the URL.
    const key = credentials.accessToken ?? credentials.apiKey ?? "";
    const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
    const headers = { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" };
    const planPrices = readPlanPrices(credentials);

    const stripeFetch = async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
      const res = await fetch(`${base}${path}`, { ...init, headers });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const err = json.error as { message?: string; code?: string } | undefined;
        throw new Error(`Stripe ${err?.code ?? res.status}: ${err?.message ?? "request failed"}`);
      }
      return json;
    };

    if (toolKey === "lookup_order") {
      const id = args.orderId as string;
      const endpoint = id.startsWith("ch_") ? "charges" : "payment_intents";
      // Route through stripeFetch so a not-found id throws a clear error instead of returning
      // Stripe's raw `{ error: … }` body (which the model might present as a real order).
      return stripeFetch(`/${endpoint}/${id}`);
    }

    if (toolKey === "issue_refund") {
      const amountCents = Math.round(Number(args.amount) * 100);
      const body = new URLSearchParams({
        charge: args.chargeId as string,
        amount: String(amountCents),
        ...(args.reason ? { reason: args.reason as string } : {}),
      });
      // stripeFetch throws on a Stripe error (already refunded, unknown charge, …) so a failed
      // refund surfaces as an error the assistant reports — never a silent error object it
      // could mistake for a successful refund.
      return stripeFetch(`/refunds`, { method: "POST", body });
    }

    // ---- Subscription tools (operator's OWN Stripe, resolved by customer email) --------

    // `softMissing` makes a genuine "no customer / no active subscription" return null
    // instead of throwing — read tools (get_subscription) use it so a not-found is a
    // definite fact the model states rather than an error it might paper over. Mutations
    // keep throwing (they can't proceed without a subscription).
    const resolveSubscription = async (
      email: string,
      opts?: { softMissing?: boolean },
    ): Promise<StripeSub | null> => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("A valid account email is required. Ask the customer for the email on their account, then try again.");
      }
      const cust = await stripeFetch(`/customers?email=${encodeURIComponent(email)}&limit=1`);
      const customer = (cust.data as { id: string }[] | undefined)?.[0];
      if (!customer) {
        if (opts?.softMissing) return null;
        throw new Error(`No Stripe customer found for ${email}.`);
      }
      const subs = await stripeFetch(`/subscriptions?customer=${customer.id}&status=all&limit=100`);
      const list = (subs.data as Array<Record<string, unknown>> | undefined) ?? [];
      // Only active/trialing count as "having a subscription"; a canceled/paused sub is treated
      // as none (get_subscription then returns the not-found message).
      const chosen = list.find((s) => s.status === "active" || s.status === "trialing");
      if (!chosen) {
        if (opts?.softMissing) return null;
        throw new Error(`No active subscription found for ${email}.`);
      }
      const items = ((chosen.items as { data?: Array<Record<string, unknown>> } | undefined)?.data) ?? [];
      const item0 = items[0] as
        | {
            id?: string;
            quantity?: number;
            current_period_end?: number;
            price?: { id?: string; recurring?: { interval?: string } };
          }
        | undefined;
      const currentPriceId = item0?.price?.id;
      const currentInterval: BillingInterval = item0?.price?.recurring?.interval === "year" ? "year" : "month";
      return {
        id: String(chosen.id),
        status: chosen.status as string | undefined,
        itemId: item0?.id,
        currentPriceId,
        plan: planForPriceId(planPrices, currentPriceId),
        currentInterval,
        currentQuantity: item0?.quantity ?? 1,
        // Stripe API 2025-03-31+ moved `current_period_end` from the subscription object onto
        // each subscription ITEM. Prefer the item's value, fall back to the (older) top-level
        // field so both API versions report the renewal/cancellation date correctly.
        currentPeriodEnd:
          item0?.current_period_end ?? (chosen.current_period_end as number | undefined),
      };
    };

    const periodEndIso = (sub: StripeSub): string | undefined =>
      sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd * 1000).toISOString() : undefined;

    if (toolKey === "get_subscription") {
      const sub = await resolveSubscription(String(args.email), { softMissing: true });
      // Only active/trialing subscriptions count. A not-found (incl. a canceled/paused sub, which
      // resolveSubscription treats as none) states plainly that there's no subscription.
      if (!sub) {
        return { found: false, hasSubscription: false, message: "No subscription is associated with this email address in our records." };
      }
      return {
        found: true,
        hasSubscription: true,
        plan: sub.plan ?? "current plan",
        status: sub.status,
        subscriptionId: sub.id,
        nextBillDate: periodEndIso(sub),
      };
    }

    if (toolKey === "upgrade_subscription" || toolKey === "downgrade_subscription") {
      const configuredPlans = Object.keys(planPrices);
      if (configuredPlans.length === 0) {
        throw new Error(
          `No plans are configured for this Stripe connection's ${sandbox ? "sandbox" : "production"} environment yet. Add the plan price ids for this environment in the dashboard (Integrations → Stripe → Configure plans), or a human can help with the plan change.`,
        );
      }
      const targetPlan = String(args.targetPlan ?? "").toLowerCase();
      if (!planPrices[targetPlan]) {
        throw new Error(`Unknown plan "${String(args.targetPlan)}". Available plans: ${configuredPlans.join(", ")}.`);
      }
      const sub = await resolveSubscription(String(args.email));
      if (!sub) throw new Error(`No active subscription found for ${String(args.email)}.`);
      const currentPlan = planForPriceId(planPrices, sub.currentPriceId);
      if (currentPlan === targetPlan) {
        return { ok: true, plan: targetPlan, status: sub.status, noChange: true, message: `Already on the ${targetPlan} plan.` };
      }
      // Change the tier but KEEP the customer's current billing interval — never mix monthly
      // and yearly. If the target plan has no price at that interval, fail clearly.
      const newPriceId = priceForPlan(planPrices, targetPlan, sub.currentInterval);
      if (!newPriceId) {
        throw new Error(
          `The ${targetPlan} plan isn't available for ${sub.currentInterval === "year" ? "annual" : "monthly"} billing. A human can help switch the plan.`,
        );
      }
      if (sub.currentPriceId === newPriceId) {
        return { ok: true, plan: targetPlan, status: sub.status, noChange: true, message: `Already on the ${targetPlan} plan.` };
      }
      if (!sub.itemId) throw new Error("Could not resolve the subscription item to update.");
      // Replace the priced item, preserving the seat quantity.
      //  - UPGRADE: charge the prorated delta NOW. `always_invoice` immediately creates and
      //    charges an invoice for the difference, so the customer pays the delta within the
      //    current period (fixes the edge case where an upgrade took effect free until the
      //    next renewal). `create_prorations` alone only defers the delta to the next invoice.
      //  - DOWNGRADE: kept as-is — `create_prorations` records the proration credit against
      //    the next invoice; no immediate charge or refund.
      const isUpgrade = toolKey === "upgrade_subscription";
      const body = new URLSearchParams();
      body.set("items[0][id]", sub.itemId);
      body.set("items[0][price]", newPriceId);
      body.set("items[0][quantity]", String(sub.currentQuantity));
      body.set("proration_behavior", isUpgrade ? "always_invoice" : "create_prorations");
      const updated = await stripeFetch(`/subscriptions/${sub.id}`, { method: "POST", body });
      // On an upgrade the delta invoice is created + paid off the customer's default payment
      // method. If it couldn't be paid, Stripe leaves the subscription past_due/unpaid —
      // surface that so the assistant doesn't claim a clean upgrade.
      const status = (updated.status as string | undefined) ?? sub.status;
      if (isUpgrade && (status === "past_due" || status === "unpaid" || status === "incomplete")) {
        throw new Error("The plan changed but the prorated payment for the upgrade didn't go through. Please check the payment method on file.");
      }
      return {
        ok: true,
        plan: targetPlan,
        billingInterval: sub.currentInterval === "year" ? "yearly" : "monthly",
        status,
        subscriptionId: sub.id,
        ...(isUpgrade ? { chargedProratedDelta: true } : {}),
      };
    }

    if (toolKey === "cancel_subscription") {
      const sub = await resolveSubscription(String(args.email));
      if (!sub) throw new Error(`No active subscription found for ${String(args.email)}.`);
      const body = new URLSearchParams({ cancel_at_period_end: "true" });
      const res = await stripeFetch(`/subscriptions/${sub.id}`, { method: "POST", body });
      return { ok: true, status: res.status ?? "active", cancelsAt: periodEndIso(sub) };
    }

    throw new Error(`Unknown tool key: ${toolKey}`);
  }

  async verifyCredentials(credentials: RawCredentials, sandbox: boolean): Promise<{ ok: boolean; error?: string }> {
    const base = sandbox ? API_TEST : API_BASE;
    const key = credentials.accessToken ?? credentials.apiKey ?? "";
    if (!key) return { ok: false, error: "No Stripe key provided." };
    // For a pasted secret/restricted key (sk_/rk_), fail fast on a test-vs-live mismatch —
    // connecting a LIVE key to the sandbox environment would let the AI issue REAL refunds.
    // (OAuth access tokens carry no such prefix and skip this check.)
    if (/_(test|live)_/.test(key)) {
      if (sandbox && /_live_/.test(key)) {
        return { ok: false, error: "That's a LIVE Stripe key (…_live_…). Use a test key (sk_test_…) for the sandbox environment." };
      }
      if (!sandbox && /_test_/.test(key)) {
        return { ok: false, error: "That's a TEST Stripe key (…_test_…). Use a live key for the production environment." };
      }
    }
    try {
      const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
      const res = await fetch(`${base}/account`, { headers: { Authorization: auth } });
      if (res.ok) return { ok: true };
      if (res.status === 401) return { ok: false, error: "Stripe rejected this key (unauthorized)." };
      return { ok: false, error: `Stripe returned HTTP ${res.status}.` };
    } catch (err) {
      return { ok: false, error: `Couldn't reach Stripe: ${(err as Error).message}` };
    }
  }
}
