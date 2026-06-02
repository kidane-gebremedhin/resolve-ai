'use client';

import { useState } from "react";
import { Button } from "@csb/ui";
import { clientApi } from "@/lib/api";
import { isPaddleConfigured, openCheckout } from "@/lib/paddle";

type Plan = {
  id: "starter" | "pro" | "enterprise";
  priceId: string | undefined;
  label: string;
};

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

  const paddleReady = isPaddleConfigured();
  const disabled = !paddleReady || !plan.priceId || !organizationId || busy || isCurrent;

  const tooltip = !paddleReady
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
      // Ask the server for overlay parameters (echoes our priceId + orgId).
      // The server response shape is { mode: "overlay", priceId, customData }.
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

export function ManageSubscriptionButton({
  hasPaddleCustomer,
  variant = "outline",
  label = "Manage subscription",
}: {
  hasPaddleCustomer: boolean;
  variant?: "default" | "outline" | "ghost";
  label?: string;
}) {
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
        disabled={!hasPaddleCustomer || busy}
        onClick={handleClick}
        title={hasPaddleCustomer ? undefined : "Subscribe first to access the customer portal"}
      >
        {busy ? "Opening…" : label}
      </Button>
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  );
}
