"use client";

// Post-signup checkout: pick a paid plan, open the Paddle overlay, then poll for
// the subscription to activate (via webhook) and continue into the dashboard.
// This is the only destination after signup until a subscription is active.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@csb/ui";
import { clientApi } from "@/lib/api";
import { isPaddleConfigured, openCheckout } from "@/lib/paddle";

type Plan = {
  plan: "starter" | "pro" | "enterprise" | "free";
  name: string;
  priceId: string | null;
  priceMonthlyUsd: number | null;
  features: string[];
};

export function CheckoutPlans({ organizationId }: { organizationId?: string }) {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clientApi
      .get<{ plans: Plan[] }>("/billing/plans")
      .then((d) => setPlans(d.plans.filter((p) => p.plan !== "free")))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load plans"));
  }, []);

  // After checkout, the webhook activates the subscription asynchronously. Poll
  // until it's active, then enter the dashboard.
  const startPolling = useCallback(() => {
    setPolling(true);
    const started = Date.now();
    const iv = setInterval(async () => {
      try {
        const sub = await clientApi.get<{ active: boolean }>("/billing/subscription");
        if (sub.active) {
          clearInterval(iv);
          router.push("/app");
          router.refresh();
        }
      } catch {
        /* keep polling */
      }
      if (Date.now() - started > 180_000) {
        clearInterval(iv);
        setPolling(false);
      }
    }, 3000);
  }, [router]);

  async function subscribe(p: Plan) {
    if (!p.priceId || !organizationId) return;
    setBusyPlan(p.plan);
    setError(null);
    try {
      await clientApi.post("/billing/checkout", { priceId: p.priceId });
      await openCheckout({
        priceId: p.priceId,
        customData: { organizationId },
        // On successful payment, activate immediately from the transaction
        // (don't wait for the webhook, which can't reach localhost), then enter
        // the dashboard.
        onCompleted: async (data) => {
          setPolling(true);
          const transactionId = data?.transaction_id ?? data?.transactionId ?? data?.id;
          try {
            if (transactionId) {
              const r = await clientApi.post<{ active: boolean }>("/billing/activate", { transactionId });
              if (r.active) {
                router.push("/app");
                router.refresh();
                return;
              }
            }
          } catch {
            /* fall back to polling below */
          }
          startPolling();
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setBusyPlan(null);
    }
  }

  if (error && !plans) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!plans) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
      </div>
    );
  }

  return (
    <div>
      {!isPaddleConfigured() ? (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Checkout is not configured (missing <code>NEXT_PUBLIC_PADDLE_CLIENT_TOKEN</code>).
        </div>
      ) : null}
      {polling ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Confirming your subscription… you&apos;ll be
          redirected automatically.
        </div>
      ) : null}
      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const highlighted = p.plan === "pro";
          const price = p.priceMonthlyUsd == null ? "Custom" : `$${p.priceMonthlyUsd}`;
          return (
            <div
              key={p.plan}
              className={`rounded-xl border bg-card p-5 ${
                highlighted ? "border-primary/50 ring-1 ring-primary/30" : "border-border"
              }`}
            >
              <div className="font-display text-lg font-semibold">{p.name}</div>
              <div className="mt-2 font-display text-3xl font-semibold">
                {price}
                <span className="text-sm font-normal text-muted-foreground">
                  {p.priceMonthlyUsd == null ? "" : "/mo"}
                </span>
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 text-success" /> {f}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-5 w-full"
                size="sm"
                disabled={!p.priceId || !organizationId || busyPlan === p.plan || polling}
                onClick={() => subscribe(p)}
              >
                {busyPlan === p.plan && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Subscribe
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
