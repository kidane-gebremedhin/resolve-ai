"use client";

// Client component for the billing page plan cards with monthly/yearly toggle.
// When the org has an active subscription, uses ChangePlanButton (schedules at
// end of period). When there's no subscription, uses ChoosePlanButton (new checkout).

import { useState } from "react";
import { Check } from "lucide-react";
import { Badge } from "@csb/ui";
import { PlanHighlighter } from "./plan-highlighter";
import { ChoosePlanButton, ChangePlanButton } from "./plan-actions";

export type BillingCatalogEntry = {
  plan: "pro" | "business" | "enterprise";
  name: string;
  priceId: string | null;
  priceMonthlyUsd: number | null;
  priceIdYearly: string | null;
  priceYearlyUsd: number | null;
  features: string[];
};

export function BillingPlansGrid({
  catalog,
  currentPlan,
  currentInterval = "month",
  organizationId,
  hasActiveSubscription,
}: {
  catalog: BillingCatalogEntry[];
  currentPlan: string | null;
  /** Billing interval of the org's active subscription — initializes the toggle. */
  currentInterval?: "month" | "year";
  organizationId?: string;
  hasActiveSubscription: boolean;
}) {
  const [billingInterval, setBillingInterval] = useState<"month" | "year">(currentInterval);

  return (
    <div>
      {/* Monthly / Yearly toggle */}
      <div className="flex items-center gap-2 mb-4">
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
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              billingInterval === "year" ? "bg-success/80 text-white" : "bg-success/15 text-success"
            }`}
          >
            Save ~30%
          </span>
        </button>
      </div>

      <PlanHighlighter className="grid gap-4 md:grid-cols-3">
        {catalog.map((p) => {
          const isCurrent = currentPlan === p.plan && billingInterval === currentInterval;
          const highlighted = !hasActiveSubscription && p.plan === "business";
          const priceId = billingInterval === "year" ? p.priceIdYearly : p.priceId;
          const priceUsd = billingInterval === "year" ? p.priceYearlyUsd : p.priceMonthlyUsd;
          const cadence = billingInterval === "year" ? "/yr" : "/mo";
          const priceLabel = priceUsd == null ? "Custom" : `$${priceUsd}`;

          return (
            <div
              key={p.plan}
              data-plan-card
              className={`cursor-pointer rounded-xl border bg-card p-5 transition ${
                isCurrent
                  ? "border-primary border-2"
                  : highlighted
                    ? "border-primary/50"
                    : "border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-display text-lg font-semibold">{p.name}</div>
                {isCurrent && <Badge variant="secondary">Current</Badge>}
              </div>
              <div className="mt-2 font-display text-3xl font-semibold">
                {priceLabel}
                {priceUsd != null && (
                  <span className="text-sm font-normal text-muted-foreground">{cadence}</span>
                )}
              </div>
              {billingInterval === "year" && priceUsd != null && p.priceMonthlyUsd != null && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  ${(priceUsd / 12).toFixed(0)}/mo billed annually
                </p>
              )}
              <ul className="mt-4 space-y-2 text-sm">
                {p.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 text-success shrink-0" />
                    {feat}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {hasActiveSubscription ? (
                  <ChangePlanButton
                    priceId={priceId}
                    planName={p.name}
                    organizationId={organizationId}
                    isCurrent={isCurrent}
                  />
                ) : (
                  <ChoosePlanButton
                    plan={{
                      id: p.plan,
                      priceId: priceId ?? undefined,
                      label: p.name,
                    }}
                    organizationId={organizationId}
                    isCurrent={isCurrent}
                  />
                )}
              </div>
            </div>
          );
        })}
      </PlanHighlighter>
    </div>
  );
}
