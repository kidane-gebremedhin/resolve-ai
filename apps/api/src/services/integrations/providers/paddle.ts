import type { ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";

type BillingInterval = "month" | "year";

// The OPERATOR's own plan → price-id mapping, stored per-connection (never the
// platform's PADDLE_PRICE_* env vars — those bill operators for THIS SaaS, whereas the
// integration tools act on the operator's OWN customers' subscriptions). Shape:
//   { pro: { monthly: "pri_x", yearly: "pri_y" }, business: {...}, ... }
export type PaddlePlanPrices = Record<string, { monthly?: string; yearly?: string }>;

function readPlanPrices(credentials: RawCredentials): PaddlePlanPrices {
  const pp = (credentials.extra as { planPrices?: unknown } | undefined)?.planPrices;
  return pp && typeof pp === "object" ? (pp as PaddlePlanPrices) : {};
}
// The price id for a plan at a given interval. No silent cross-interval fallback:
// if yearly isn't configured for that plan the caller must handle it, so we never
// change a customer's billing cadence behind their back.
function priceForPlan(planPrices: PaddlePlanPrices, plan: string, interval: BillingInterval): string | undefined {
  return planPrices[plan]?.[interval === "year" ? "yearly" : "monthly"];
}
// Reverse map (price id → plan name). Covers BOTH monthly and yearly price ids so
// get_subscription can name a customer's current plan regardless of billing cycle.
function planForPriceId(planPrices: PaddlePlanPrices, priceId: string | undefined): string | undefined {
  if (!priceId) return undefined;
  return Object.entries(planPrices).find(([, ids]) => ids.monthly === priceId || ids.yearly === priceId)?.[0];
}

type PaddleSub = {
  id: string;
  status?: string;
  currentPriceId?: string;
  plan?: string;
  // The subscription's actual billing cadence + seat count, read from the live
  // Paddle item — used so a plan change preserves EVERY detail (interval + quantity),
  // not just the plan tier.
  currentInterval: BillingInterval;
  currentQuantity: number;
  nextBilledAt?: string;
};

export class PaddleAdapter implements ProviderAdapter {
  readonly provider = "paddle";

  buildAuthUrl(_orgId: string, _state: string): string | null {
    return null; // Paddle uses API key auth, not OAuth
  }

  // Confirm the key works against the selected environment (sandbox vs live) —
  // a common mistake is pasting a sandbox key while the connection is production.
  async verifyCredentials(credentials: RawCredentials, sandbox: boolean): Promise<{ ok: boolean; error?: string }> {
    const apiKey = credentials.apiKey ?? "";
    if (!apiKey) return { ok: false, error: "No API key provided." };
    const baseUrl = sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
    try {
      const res = await fetch(`${baseUrl}/event-types`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `Paddle rejected this key for the ${sandbox ? "sandbox" : "production"} environment. Make sure it's a ${sandbox ? "sandbox" : "live"} key.` };
      }
      return { ok: false, error: `Paddle returned HTTP ${res.status}.` };
    } catch (err) {
      return { ok: false, error: `Couldn't reach Paddle: ${(err as Error).message}` };
    }
  }

  async exchangeCode(_code: string, _orgId: string): Promise<RawCredentials> {
    throw new Error("Paddle uses API key auth. Use the api_key authMode.");
  }

  async refreshTokens(_blob: EncryptedBlob): Promise<RawCredentials | null> {
    return null;
  }

  getTools(): ToolTemplate[] {
    // All tools are keyed off the customer's EMAIL and a human plan NAME — never
    // raw Paddle ids, which neither the AI nor the customer knows. The adapter
    // resolves the subscription + price id server-side.
    //
    // `email` is intentionally OPTIONAL: the widget already knows the visitor's
    // verified account email (captured in the contact form) and the dispatcher
    // injects it authoritatively before execution. The model never sees the real
    // email (PII redaction masks it), so requiring it here would just make the AI
    // loop asking the customer for something the system already has.
    const planEnum = ["pro", "business", "enterprise"];
    const emailProp = {
      type: "string" as const,
      description: "The customer's account email. Optional — leave blank and the system uses their verified account email automatically.",
    };
    return [
      {
        key: "get_subscription",
        displayName: "Get Subscription",
        description: "Look up the customer's current subscription (plan, status, renewal). Uses their verified account email automatically — do NOT ask the customer for their email.",
        jsonSchema: {
          type: "object",
          properties: { email: emailProp },
          required: [],
        },
      },
      {
        key: "upgrade_subscription",
        displayName: "Upgrade Subscription",
        description: "Upgrade the customer's subscription to a higher plan. Uses their verified account email automatically.",
        jsonSchema: {
          type: "object",
          properties: {
            email: emailProp,
            targetPlan: { type: "string", enum: planEnum, description: "Plan to move to" },
          },
          required: ["targetPlan"],
        },
      },
      {
        key: "downgrade_subscription",
        displayName: "Downgrade Subscription",
        description: "Downgrade the customer's subscription to a lower plan. Uses their verified account email automatically.",
        jsonSchema: {
          type: "object",
          properties: {
            email: emailProp,
            targetPlan: { type: "string", enum: planEnum, description: "Plan to move to" },
          },
          required: ["targetPlan"],
        },
      },
      {
        key: "cancel_subscription",
        displayName: "Cancel Subscription",
        description: "Cancel the customer's subscription at the end of the current billing period. Uses their verified account email automatically.",
        jsonSchema: {
          type: "object",
          properties: { email: emailProp },
          required: [],
        },
      },
    ];
  }

  async execute(
    toolKey: string,
    args: Record<string, unknown>,
    credentials: RawCredentials,
    sandbox: boolean,
  ): Promise<unknown> {
    const apiKey = credentials.apiKey ?? "";
    const baseUrl = sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    // The operator's own plan → price-id mapping for THIS connection.
    const planPrices = readPlanPrices(credentials);
    const yearlyIds = Object.values(planPrices).map((p) => p.yearly).filter(Boolean);

    const getJson = async (url: string, init?: RequestInit): Promise<Record<string, unknown>> => {
      const res = await fetch(url, { ...init, headers });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const err = json.error as { detail?: string; code?: string } | undefined;
        throw new Error(`Paddle ${err?.code ?? res.status}: ${err?.detail ?? "request failed"}`);
      }
      return json;
    };

    // Resolve a customer's active subscription from their email. A single Paddle
    // customer (same email) can hold subscriptions for MULTIPLE tenants/orgs, so
    // when an organizationId is supplied we pick the subscription tagged with that
    // org in custom_data — never an arbitrary one belonging to another workspace.
    const orgId = args.organizationId ? String(args.organizationId) : undefined;
    // `softMissing` makes a genuine "this email has no customer / no active
    // subscription" return null instead of throwing. Read tools (get_subscription)
    // use it so a not-found is a definite fact the model can state, NOT an error the
    // model might paper over by inventing a plan. Mutations keep throwing (they
    // can't proceed without a subscription).
    const resolveSubscription = async (
      email: string,
      opts?: { softMissing?: boolean },
    ): Promise<PaddleSub | null> => {
      // Guard the common race where the tool fires before the widget has captured
      // the visitor's email (contact form not yet completed): querying Paddle with
      // "undefined"/blank yields an opaque 400. Fail with a clear, askable message.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("A valid account email is required. Ask the customer for the email on their account, then try again.");
      }
      // Email is the identifier, so resolve the customer by email regardless of status.
      // Paddle's list-customers defaults to ACTIVE only; an operator can reuse a customer
      // across subscriptions and it may be ARCHIVED (e.g. after an earlier cancel), yet still
      // hold the live subscription we need — so ask for both statuses or we'd miss them.
      const cust = await getJson(
        `${baseUrl}/customers?email=${encodeURIComponent(email)}&status=active&status=archived`,
      );
      const customers = (cust.data as { id: string; status?: string }[] | undefined) ?? [];
      // Prefer an active customer when several share the email; fall back to the first.
      const customer = customers.find((c) => c.status === "active") ?? customers[0];
      if (!customer) {
        if (opts?.softMissing) return null;
        throw new Error(`No Paddle customer found for ${email}.`);
      }
      // Only active/trialing count as "having a subscription". A canceled/paused subscription is
      // treated as no subscription (get_subscription then returns the not-found message).
      const subs = await getJson(
        `${baseUrl}/subscriptions?customer_id=${customer.id}&status=active&status=trialing`,
      );
      const list = (subs.data as Array<Record<string, unknown>> | undefined) ?? [];
      if (list.length === 0) {
        if (opts?.softMissing) return null;
        throw new Error(`No active subscription found for ${email}.`);
      }
      const scoped = orgId
        ? list.find(
            (s) => (s.custom_data as { organizationId?: string } | undefined)?.organizationId === orgId,
          )
        : undefined;
      const sub = scoped ?? list[0];
      const items = (sub.items as
        | Array<{ quantity?: number; price?: { id?: string; billing_cycle?: { interval?: string } } }>
        | undefined) ?? [];
      const item0 = items[0];
      const currentPriceId = item0?.price?.id;
      // Prefer the interval Paddle reports on the price; fall back to matching the
      // operator's configured yearly ids (covers prices missing billing_cycle).
      const currentInterval: BillingInterval =
        item0?.price?.billing_cycle?.interval === "year" || yearlyIds.includes(currentPriceId)
          ? "year"
          : "month";
      return {
        id: String(sub.id),
        status: sub.status as string | undefined,
        currentPriceId,
        plan: planForPriceId(planPrices, currentPriceId),
        currentInterval,
        currentQuantity: item0?.quantity ?? 1,
        nextBilledAt: sub.next_billed_at as string | undefined,
      };
    };

    if (toolKey === "get_subscription") {
      const sub = await resolveSubscription(String(args.email), { softMissing: true });
      // Only active/trialing subscriptions count. A not-found (incl. a canceled/paused sub, which
      // resolveSubscription treats as none) states plainly that there's no subscription — never
      // guess a plan.
      if (!sub) {
        return {
          found: false,
          hasSubscription: false,
          message: "No subscription is associated with this email address in our records.",
        };
      }
      return {
        found: true,
        hasSubscription: true,
        plan: sub.plan ?? "current plan",
        status: sub.status,
        subscriptionId: sub.id,
        nextBillDate: sub.nextBilledAt,
      };
    }

    if (toolKey === "upgrade_subscription" || toolKey === "downgrade_subscription") {
      const configuredPlans = Object.keys(planPrices);
      if (configuredPlans.length === 0) {
        // Name the environment: the usual cause is plans configured in one environment
        // (e.g. sandbox) while the connection is now serving the other (production),
        // whose credential slot has no price-id map. The operator must add the plan
        // price ids for THIS environment.
        throw new Error(
          `No plans are configured for this Paddle connection's ${sandbox ? "sandbox" : "production"} environment yet. Add the plan price ids for this environment in the dashboard (Integrations → Paddle → Configure plans), or a human can help with the plan change.`,
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
      // Change the tier but KEEP the customer's current billing interval — never mix
      // monthly and yearly. If the target plan has no price at that interval, fail
      // clearly rather than silently flipping their cadence.
      const newPriceId = priceForPlan(planPrices, targetPlan, sub.currentInterval);
      if (!newPriceId) {
        throw new Error(
          `The ${targetPlan} plan isn't available for ${sub.currentInterval === "year" ? "annual" : "monthly"} billing. A human can help switch the plan.`,
        );
      }
      if (sub.currentPriceId === newPriceId) {
        return { ok: true, plan: targetPlan, status: sub.status, noChange: true, message: `Already on the ${targetPlan} plan.` };
      }
      // Replace the priced item, preserving the existing seat quantity.
      //  - UPGRADE: bill the prorated delta NOW. `prorated_immediately` calculates the
      //    difference and charges the customer's payment method this period (so an upgrade
      //    is never granted free until the next renewal).
      //  - DOWNGRADE: kept as-is — Paddle's `prorated_immediately` applies the proration
      //    credit at the switch; downgrade behavior is unchanged.
      const isUpgrade = toolKey === "upgrade_subscription";
      const updated = await getJson(`${baseUrl}/subscriptions/${sub.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          items: [{ price_id: newPriceId, quantity: sub.currentQuantity }],
          proration_billing_mode: "prorated_immediately",
        }),
      });
      const data = (updated.data ?? updated) as Record<string, unknown>;
      const status = (data.status as string | undefined) ?? sub.status;
      // If the upgrade's prorated charge didn't clear, Paddle leaves the subscription
      // past_due — surface it so the assistant doesn't report a clean upgrade.
      if (isUpgrade && status === "past_due") {
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
      const res = await getJson(`${baseUrl}/subscriptions/${sub.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ effective_from: "next_billing_period" }),
      });
      const data = (res.data ?? res) as Record<string, unknown>;
      return { ok: true, status: data.status ?? "canceled", cancelsAt: data.scheduled_change ?? sub.nextBilledAt };
    }

    throw new Error(`Unknown tool key: ${toolKey}`);
  }
}
