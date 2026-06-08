"use client";

// Post-signup checkout. If a plan was chosen on /pricing (carried via ?plan= or
// sessionStorage), we resolve it and open its Paddle overlay directly. If NO plan
// was selected (e.g. the user just logged in), we render the full plans grid here
// so they can pick one without leaving checkout. Either path opens the Paddle
// overlay, then polls for the subscription to activate and continues to /app.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@csb/ui";
import { clientApi } from "@/lib/api";
import { isPaddleConfigured, openCheckout } from "@/lib/paddle";
import { PLAN_STORAGE_KEY } from "./plan-cta";
import { PlanHighlighter } from "./plan-highlighter";

type Plan = {
  plan: "starter" | "pro" | "enterprise" | "free";
  name: string;
  priceId: string | null;
  priceMonthlyUsd: number | null;
  features: string[];
};

export function CheckoutPlans({
  organizationId,
  customerEmail,
  preselectedPlan,
}: {
  organizationId?: string;
  /** Logged-in user's email — pre-fills the Paddle overlay. */
  customerEmail?: string;
  /** Plan tier from the URL (?plan=); falls back to the sessionStorage choice. */
  preselectedPlan?: string;
}) {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [chosenTier, setChosenTier] = useState<string | undefined>(preselectedPlan || undefined);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when payment succeeded but activation didn't confirm in time — we then
  // offer a manual "Continue to dashboard" button instead of a dead end.
  const [activationStuck, setActivationStuck] = useState(false);
  const autoStarted = useRef(false);

  // Clear the checkout-plan hint and enter the dashboard. Used by every success
  // path so they behave identically.
  const finishAndEnter = useCallback(() => {
    try {
      sessionStorage.removeItem(PLAN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    router.push("/app");
    router.refresh();
  }, [router]);

  // Resolve the chosen plan: URL param first, else the pricing-page selection.
  useEffect(() => {
    if (chosenTier) return;
    try {
      const stored = sessionStorage.getItem(PLAN_STORAGE_KEY);
      if (stored) setChosenTier(stored);
    } catch {
      /* sessionStorage unavailable */
    }
  }, [chosenTier]);

  useEffect(() => {
    clientApi
      .get<{ plans: Plan[] }>("/billing/plans")
      .then((d) => setPlans(d.plans.filter((p) => p.plan !== "free")))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load plans"));
  }, []);

  // After checkout, the subscription activates either via the Paddle webhook
  // (production) or the transaction-based /billing/activate call (works on
  // localhost, where the webhook can't reach us). Poll BOTH each tick: re-try
  // the direct activation if we have a transaction id, and check the webhook
  // path. Either confirming → enter the dashboard. If neither confirms within
  // the window, surface a manual "Continue to dashboard" button instead of
  // silently stranding the user on the checkout page.
  const startPolling = useCallback(
    (transactionId?: string) => {
      setPolling(true);
      const started = Date.now();
      const iv = setInterval(async () => {
        try {
          // Retry the direct activation every tick — the first attempt in
          // onCompleted can race ahead of Paddle marking the txn paid.
          if (transactionId) {
            try {
              const r = await clientApi.post<{ active: boolean }>("/billing/activate", {
                transactionId,
              });
              if (r.active) {
                clearInterval(iv);
                finishAndEnter();
                return;
              }
            } catch {
              /* fall through to the webhook check */
            }
          }
          const sub = await clientApi.get<{ active: boolean }>("/billing/subscription");
          if (sub.active) {
            clearInterval(iv);
            finishAndEnter();
            return;
          }
        } catch {
          /* keep polling */
        }
        if (Date.now() - started > 180_000) {
          clearInterval(iv);
          setPolling(false);
          setActivationStuck(true);
          setError("Payment received, but activation is taking longer than usual.");
        }
      }, 3000);
    },
    [finishAndEnter],
  );

  const subscribe = useCallback(
    async (p: Plan) => {
      if (!p.priceId || !organizationId) return;
      setBusy(true);
      setError(null);
      try {
        await clientApi.post("/billing/checkout", { priceId: p.priceId });
        await openCheckout({
          priceId: p.priceId,
          customData: { organizationId },
          customerEmail,
          // On successful payment, activate immediately from the transaction
          // (don't wait for the webhook, which can't reach localhost), then enter
          // the dashboard.
          onCompleted: async (data) => {
            setPolling(true);
            // Paddle's checkout.completed payload nests the id differently across
            // versions — check the known shapes before giving up.
            const transactionId =
              data?.transaction_id ??
              data?.transactionId ??
              data?.id ??
              data?.data?.transaction_id ??
              data?.data?.id;
            try {
              if (transactionId) {
                const r = await clientApi.post<{ active: boolean }>("/billing/activate", { transactionId });
                if (r.active) {
                  finishAndEnter();
                  return;
                }
              }
            } catch {
              /* fall back to polling below */
            }
            // Keep retrying activation (with the txn id) AND the webhook path.
            startPolling(transactionId);
          },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Checkout failed.");
      } finally {
        setBusy(false);
      }
    },
    [organizationId, customerEmail, startPolling, finishAndEnter],
  );

  // The resolved, purchasable plan (has a price id).
  const chosen = plans && chosenTier ? plans.find((p) => p.plan === chosenTier && p.priceId) : undefined;

  // Open the overlay once, automatically, for the chosen plan.
  useEffect(() => {
    if (autoStarted.current || !chosen || !organizationId || !isPaddleConfigured()) return;
    autoStarted.current = true;
    const id = setTimeout(() => void subscribe(chosen), 0);
    return () => clearTimeout(id);
  }, [chosen, organizationId, subscribe]);

  if (!plans) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Preparing checkout…
      </div>
    );
  }

  // No plan remembered (e.g. the user logged in without picking one on /pricing)
  // — show the full plans grid here so they can choose without leaving checkout.
  if (!chosen) {
    return (
      <div>
        {!isPaddleConfigured() ? (
          <div className="mx-auto mb-6 max-w-md rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-center text-sm">
            Checkout is not configured (missing <code>NEXT_PUBLIC_PADDLE_CLIENT_TOKEN</code>).
          </div>
        ) : null}
        {error ? <p className="mb-4 text-center text-sm text-destructive">{error}</p> : null}
        <PlanHighlighter className="grid gap-4 sm:grid-cols-3">
          {plans.map((p) => {
            const highlighted = p.plan === "pro";
            const priceLabel = p.priceMonthlyUsd == null ? "Custom" : `$${p.priceMonthlyUsd}`;
            return (
              <div
                key={p.plan}
                data-plan-card
                className={`flex cursor-pointer flex-col rounded-xl border bg-card p-6 transition ${
                  highlighted ? "border-primary" : "border-border"
                }`}
              >
                <div className="font-display text-lg font-semibold">{p.name}</div>
                <div className="mt-1 font-display text-3xl font-semibold">
                  {priceLabel}
                  {p.priceMonthlyUsd == null ? "" : (
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  )}
                </div>
                {p.features?.length ? (
                  <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
                    {p.features.map((f, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-primary">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex-1" />
                )}
                <Button
                  className="mt-6"
                  size="sm"
                  variant={highlighted ? "default" : "outline"}
                  onClick={() => subscribe(p)}
                  disabled={busy || polling || !isPaddleConfigured() || !p.priceId}
                >
                  {polling ? "Confirming…" : `Choose ${p.name}`}
                </Button>
              </div>
            );
          })}
        </PlanHighlighter>
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => router.push("/pricing")}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Compare plans in detail
          </button>
        </div>
      </div>
    );
  }

  const price = chosen.priceMonthlyUsd == null ? "Custom" : `$${chosen.priceMonthlyUsd}`;

  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-6 text-center">
      <div className="font-display text-lg font-semibold">{chosen.name} plan</div>
      <div className="mt-1 font-display text-3xl font-semibold">
        {price}
        {chosen.priceMonthlyUsd == null ? "" : <span className="text-sm font-normal text-muted-foreground">/mo</span>}
      </div>

      {!isPaddleConfigured() ? (
        <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Checkout is not configured (missing <code>NEXT_PUBLIC_PADDLE_CLIENT_TOKEN</code>).
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {polling ? "Confirming your subscription…" : "Opening secure checkout…"}
          </div>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          <div className="mt-5 flex flex-col items-center gap-2">
            {activationStuck ? (
              <Button size="sm" onClick={finishAndEnter}>
                Continue to dashboard
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={activationStuck ? "outline" : "default"}
              onClick={() => subscribe(chosen)}
              disabled={busy || polling}
            >
              Continue to checkout
            </Button>
            <button
              type="button"
              onClick={() => router.push("/pricing")}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Choose a different plan
            </button>
          </div>
        </>
      )}
    </div>
  );
}
