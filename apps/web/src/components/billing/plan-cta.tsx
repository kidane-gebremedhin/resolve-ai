"use client";

// Pricing-page plan button. Remembers the chosen plan (sessionStorage) so the
// checkout page can open that plan's Paddle overlay directly without re-showing
// the plans — and also carries it in the URL as a fallback. Shared key with
// CheckoutPlans (PLAN_STORAGE_KEY).
export const PLAN_STORAGE_KEY = "csb_checkout_plan";

export function PlanCta({
  tier,
  className,
  children,
}: {
  tier: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`/register?plan=${encodeURIComponent(tier)}`}
      className={className}
      onClick={() => {
        try {
          if (tier) sessionStorage.setItem(PLAN_STORAGE_KEY, tier);
        } catch {
          /* sessionStorage unavailable — the ?plan= URL param still carries it */
        }
      }}
    >
      {children}
    </a>
  );
}
