"use client";

// Post-signup checkout. If a plan was chosen on /pricing (carried via ?plan= or
// sessionStorage), open its Paddle overlay directly with a minimal transition screen.
// If NO plan was selected, show the full plans grid so they can pick one.
// On payment, polls for activation. If activation doesn't confirm within 3 minutes,
// redirects to /checkout/pending rather than stranding the user.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@csb/ui";
import { clientApi } from "@/lib/api";
import { isPaddleConfigured, openCheckout } from "@/lib/paddle";
import { PLAN_STORAGE_KEY, CYCLE_STORAGE_KEY } from "./plan-cta";
import { PlanHighlighter } from "./plan-highlighter";

type Plan = {
  plan: "pro" | "business" | "enterprise";
  name: string;
  priceId: string | null;
  priceMonthlyUsd: number | null;
  priceIdYearly: string | null;
  priceYearlyUsd: number | null;
  features: string[];
};

export function CheckoutPlans({
  organizationId,
  customerEmail,
  preselectedPlan,
  preselectedCycle = "month",
}: {
  organizationId?: string;
  /** Logged-in user's email — pre-fills the Paddle overlay. */
  customerEmail?: string;
  /** Plan tier from the URL (?plan=); falls back to the sessionStorage choice. */
  preselectedPlan?: string;
  /** Billing cycle from the URL (?cycle=); falls back to sessionStorage, then "month". */
  preselectedCycle?: "month" | "year";
}) {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [chosenTier, setChosenTier] = useState<string | undefined>(preselectedPlan || undefined);
  const [billingInterval, setBillingInterval] = useState<"month" | "year">(preselectedCycle);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultHighlight, setDefaultHighlight] = useState<string>("business");
  const autoStarted = useRef(false);

  // Clear the checkout-plan hint and enter the dashboard. Used by every success
  // path so they behave identically.
  const finishAndEnter = useCallback(() => {
    try {
      sessionStorage.removeItem(PLAN_STORAGE_KEY);
      sessionStorage.removeItem(CYCLE_STORAGE_KEY);
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

  // Resolve the billing cycle: URL param / prop first, else the pricing-page
  // selection stored in sessionStorage when the CTA was clicked.
  useEffect(() => {
    if (preselectedCycle !== "month") return; // URL/prop already has a non-default value
    try {
      const stored = sessionStorage.getItem(CYCLE_STORAGE_KEY);
      if (stored === "year") setBillingInterval("year");
    } catch {
      /* sessionStorage unavailable */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    clientApi
      .get<{ plans: Plan[] }>("/billing/plans")
      .then((d) => setPlans(d.plans))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load plans"));
  }, []);

  // After checkout, the subscription activates either via the Paddle webhook
  // (production) or the transaction-based /billing/activate call (works on
  // localhost). Poll both each tick. If neither confirms within 3 minutes,
  // redirect to /checkout/pending (pending subscription status) rather than
  // stranding the user here.
  const startPolling = useCallback(
    (transactionId?: string) => {
      setPolling(true);
      const started = Date.now();
      const iv = setInterval(async () => {
        try {
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
          try {
            sessionStorage.removeItem(PLAN_STORAGE_KEY);
            sessionStorage.removeItem(CYCLE_STORAGE_KEY);
          } catch {
            /* ignore */
          }
          router.push("/checkout/pending");
        }
      }, 3000);
    },
    [finishAndEnter, router],
  );

  const subscribe = useCallback(
    async (p: Plan, interval: "month" | "year" = "month") => {
      const priceId = interval === "year" ? (p.priceIdYearly ?? p.priceId) : p.priceId;
      if (!priceId || !organizationId) return;
      setBusy(true);
      setError(null);
      try {
        await clientApi.post("/billing/checkout", { priceId });
        await openCheckout({
          priceId,
          customData: { organizationId },
          customerEmail,
          onCompleted: async (data) => {
            setPolling(true);
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
              /* fall back to polling */
            }
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
    const id = setTimeout(() => void subscribe(chosen, billingInterval), 0);
    return () => clearTimeout(id);
  }, [chosen, organizationId, subscribe]);

  if (!plans) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Preparing checkout…
      </div>
    );
  }

  // Pre-selected plan: show a minimal transition screen and open the overlay.
  // The user already compared plans on /pricing; no need to show the full grid.
  if (chosen) {
    return (
      <div className="mx-auto max-w-sm text-center">
        {!isPaddleConfigured() ? (
          <div className="mb-6 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            Checkout is not configured (missing <code>NEXT_PUBLIC_PADDLE_CLIENT_TOKEN</code>).
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">Starting checkout for</p>
        <p className="mt-1 font-display text-xl font-semibold">{chosen.name} plan</p>

        {isPaddleConfigured() ? (
          <>
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {polling ? "Confirming your subscription…" : "Opening secure checkout…"}
            </div>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
            <div className="mt-5 flex flex-col items-center gap-2">
              <Button
                size="sm"
                onClick={() => void subscribe(chosen, billingInterval)}
                disabled={busy || polling}
              >
                Continue to checkout
              </Button>
              <button
                type="button"
                onClick={() => {
                  try {
                    sessionStorage.removeItem(PLAN_STORAGE_KEY);
                    sessionStorage.removeItem(CYCLE_STORAGE_KEY);
                  } catch {
                    /* ignore */
                  }
                  setChosenTier(undefined);
                }}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Choose a different plan
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  // No plan selected — show the full grid so the user can compare and pick.
  return (
    <div>
      {!isPaddleConfigured() ? (
        <div className="mx-auto mb-6 max-w-md rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-center text-sm">
          Checkout is not configured (missing <code>NEXT_PUBLIC_PADDLE_CLIENT_TOKEN</code>).
        </div>
      ) : null}
      {polling ? (
        <div className="mx-auto mb-6 max-w-md rounded-md border border-border bg-card px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Confirming your subscription…
          </div>
        </div>
      ) : null}
      {error ? <p className="mb-4 text-center text-sm text-destructive">{error}</p> : null}

      {/* Billing interval toggle */}
      <div className="mb-4 flex items-center justify-center gap-2">
        <button
          onClick={() => setBillingInterval("month")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            billingInterval === "month"
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBillingInterval("year")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
            billingInterval === "year"
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          Yearly
          <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
            Save ~30%
          </span>
        </button>
      </div>

      <PlanHighlighter className="grid gap-4 sm:grid-cols-3">
        {plans.map((p) => {
          const highlighted = p.plan === defaultHighlight;
          const priceUsd = billingInterval === "year" ? p.priceYearlyUsd : p.priceMonthlyUsd;
          const cadence = billingInterval === "year" ? "/yr" : "/mo";
          const priceLabel =
            priceUsd == null
              ? "Custom"
              : `$${priceUsd.toLocaleString("en-US", {
                  minimumFractionDigits: Number.isInteger(priceUsd) ? 0 : 2,
                  maximumFractionDigits: 2,
                })}`;
          const activePriceId = billingInterval === "year" ? (p.priceIdYearly ?? p.priceId) : p.priceId;
          return (
            <div
              key={p.plan}
              data-plan-card
              onClick={() => setDefaultHighlight(p.plan)}
              className={`flex cursor-pointer flex-col rounded-xl border bg-card p-6 transition ${
                highlighted ? "border-primary" : "border-border"
              }`}
            >
              <div className="font-display text-lg font-semibold">{p.name}</div>
              <div className="mt-1 font-display text-3xl font-semibold">
                {priceLabel}
                {priceUsd != null && (
                  <span className="text-sm font-normal text-muted-foreground">{cadence}</span>
                )}
              </div>
              {billingInterval === "year" && priceUsd != null && p.priceMonthlyUsd != null && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  ${(priceUsd / 12).toFixed(0)}/mo billed annually
                </p>
              )}
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
                onClick={(e) => {
                  e.stopPropagation();
                  void subscribe(p, billingInterval);
                }}
                disabled={busy || polling || !isPaddleConfigured() || !activePriceId}
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
