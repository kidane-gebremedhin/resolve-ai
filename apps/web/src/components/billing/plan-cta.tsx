"use client";

// Pricing-page plan button. Remembers the chosen plan AND billing cycle
// (sessionStorage) so the checkout page can open the right Paddle overlay
// directly. Both are also carried in the URL as fallbacks. Shared keys with
// CheckoutPlans.
export const PLAN_STORAGE_KEY = "csb_checkout_plan";
export const CYCLE_STORAGE_KEY = "csb_checkout_cycle";

export function PlanCta({
  tier,
  cycle = "month",
  className,
  children,
}: {
  tier: string;
  cycle?: "month" | "year";
  className?: string;
  children: React.ReactNode;
}) {
  const href = `/register?plan=${encodeURIComponent(tier)}&cycle=${cycle}`;
  return (
    <a
      href={href}
      className={className}
      onClick={() => {
        try {
          if (tier) sessionStorage.setItem(PLAN_STORAGE_KEY, tier);
          sessionStorage.setItem(CYCLE_STORAGE_KEY, cycle);
        } catch {
          /* sessionStorage unavailable — the URL params still carry both values */
        }
      }}
    >
      {children}
    </a>
  );
}
