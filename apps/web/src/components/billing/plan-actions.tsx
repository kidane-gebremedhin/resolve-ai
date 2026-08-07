'use client';

import { useState } from "react";
import { Button } from "@csb/ui";
import { clientApi } from "@/lib/api";
import { isPaddleConfigured, openCheckout } from "@/lib/paddle";
import { useCan } from "@/hooks/use-permissions";
import { deniedReason } from "@/lib/permissions";

// Every mutating billing call (POST /billing/checkout, /change-plan, /portal) is
// requireOrgRole("admin") on the API. Reads stay open, so agents and viewers can
// still SEE the plan they're on — they just get no purchase controls.
const BILLING_DENIED = deniedReason("manageBilling");

type Plan = {
  id: "pro" | "business" | "enterprise";
  priceId: string | undefined;
  label: string;
};

// Opens a new Paddle checkout for users without an active subscription.
export function ChoosePlanButton({
  plan,
  organizationId,
  isCurrent,
}: {
  plan: Plan;
  organizationId: string | undefined;
  isCurrent: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canManage = useCan("manageBilling");
  const paddleReady = isPaddleConfigured();
  const disabled =
    !canManage || !paddleReady || !plan.priceId || !organizationId || busy || isCurrent;

  const tooltip = !canManage
    ? BILLING_DENIED
    : !paddleReady
      ? "Paddle not configured"
      : !plan.priceId
        ? `Set NEXT_PUBLIC_PADDLE_PRICE_${plan.id.toUpperCase()}`
        : !organizationId
          ? "Sign in required"
          : undefined;

  async function handleClick(): Promise<void> {
    if (!plan.priceId || !organizationId) return;
    setBusy(true);
    setErr(null);
    try {
      await clientApi.post<{
        mode: "overlay" | "redirect";
        priceId: string;
        customData: { organizationId: string };
        url?: string;
      }>("/billing/checkout", { priceId: plan.priceId });

      await openCheckout({
        priceId: plan.priceId,
        customData: { organizationId },
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        className="w-full"
        variant={isCurrent ? "outline" : "default"}
        disabled={disabled}
        onClick={handleClick}
        title={tooltip}
      >
        {isCurrent ? "Current plan" : busy ? "Opening…" : `Choose ${plan.label}`}
      </Button>
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  );
}

// Schedules a plan change at the end of the current billing period (do_not_bill).
// Used when the org already has an active Paddle subscription.
export function ChangePlanButton({
  priceId,
  planName,
  organizationId,
  isCurrent,
}: {
  priceId: string | null | undefined;
  planName: string;
  organizationId: string | undefined;
  isCurrent: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canManage = useCan("manageBilling");
  const disabled = !canManage || !priceId || !organizationId || busy || isCurrent;

  async function handleClick(): Promise<void> {
    if (!priceId || !organizationId || isCurrent) return;
    setBusy(true);
    setErr(null);
    try {
      await clientApi.post<{ scheduledAt: string | null }>("/billing/change-plan", { priceId });
      setScheduled(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to schedule plan change.");
    } finally {
      setBusy(false);
    }
  }

  if (scheduled) {
    return (
      <p className="text-xs text-success font-medium">
        ✓ Switching to {planName} at next renewal
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        className="w-full"
        variant={isCurrent ? "outline" : "default"}
        disabled={disabled}
        onClick={handleClick}
        title={canManage ? undefined : BILLING_DENIED}
      >
        {isCurrent ? "Current plan" : busy ? "Scheduling…" : `Switch to ${planName}`}
      </Button>
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  );
}

export function ManageSubscriptionButton({
  hasPaddleCustomer,
  variant = "outline",
  label = "Manage subscription",
}: {
  hasPaddleCustomer: boolean;
  variant?: "default" | "outline" | "ghost";
  label?: string;
}) {
  const canManage = useCan("manageBilling");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const res = await clientApi.post<{ url: string }>("/billing/portal");
      window.open(res.url, "_blank", "noopener");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to open portal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant={variant}
        disabled={!canManage || !hasPaddleCustomer || busy}
        onClick={handleClick}
        title={
          !canManage
            ? BILLING_DENIED
            : hasPaddleCustomer
              ? undefined
              : "Subscribe first to access the customer portal"
        }
      >
        {busy ? "Opening…" : label}
      </Button>
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  );
}
