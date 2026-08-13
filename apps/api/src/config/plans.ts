// Single source of truth for subscription plans: limits, display prices, and
// the Paddle price IDs (from env). Both quota enforcement
// (plan-limit.middleware) and the billing/pricing UIs (GET /billing/plans) read
// from here so limits, prices, and price IDs never drift apart.

export type Plan = "pro" | "business" | "enterprise";

// The plan keys as a runtime array, for schema enums and validators that must
// not drift from the `Plan` union. Typed so adding a Plan without adding it here
// is a compile error.
export const PLAN_KEYS = ["pro", "business", "enterprise"] as const satisfies readonly Plan[];

// Ordering used wherever "is this an upgrade?" has to be decided — plan changes
// in billing.service and the coupon rule that redeeming must never downgrade an
// organization. An org with no plan ranks 0, below every purchasable tier.
//
// Always compare through `planRank()`; never chain `if` comparisons on plan
// strings, and never compare against a value outside `Plan`.
export const PLAN_RANK: Record<Plan, number> = { pro: 1, business: 2, enterprise: 3 };

/** Rank of a plan value; 0 for null/undefined/unrecognised (i.e. unsubscribed). */
export function planRank(plan: string | null | undefined): number {
  if (!plan) return 0;
  return PLAN_RANK[plan as Plan] ?? 0;
}

// Internal key → display name mapping (used by admin utils + subscription table).
export const PLAN_DISPLAY_NAMES: Record<Plan, string> = {
  pro: "Pro",
  business: "Business",
  enterprise: "Enterprise",
};

export type PlanLimits = {
  messagesPerMonth: number;
  knowledgeSources: number;
  websites: number;
  teamMembers: number;
};

const INF = Number.POSITIVE_INFINITY;

// Fallback limits for orgs with no active subscription. Not a purchasable plan.
const UNSUBSCRIBED_LIMITS: PlanLimits = {
  messagesPerMonth: 0,
  knowledgeSources: 0,
  websites: 0,
  teamMembers: 0,
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  pro: { messagesPerMonth: 2_000, knowledgeSources: 25, websites: 3, teamMembers: 5 },
  business: { messagesPerMonth: 20_000, knowledgeSources: 200, websites: 10, teamMembers: 25 },
  enterprise: {
    messagesPerMonth: INF,
    knowledgeSources: INF,
    websites: INF,
    teamMembers: INF,
  },
};

export function limitsForPlan(plan: string | null | undefined): PlanLimits {
  if (!plan) return UNSUBSCRIBED_LIMITS;
  return PLAN_LIMITS[plan as Plan] ?? UNSUBSCRIBED_LIMITS;
}

export type PlanCatalogEntry = {
  plan: Plan;
  name: string;
  /** Paddle monthly price id; null if unconfigured. */
  priceId: string | null;
  /** Display price in USD/month; null = "custom". */
  priceMonthlyUsd: number | null;
  /** Paddle yearly price id; null if not configured. */
  priceIdYearly: string | null;
  /** Display price in USD/year; null = "custom". */
  priceYearlyUsd: number | null;
  features: string[];
  limits: PlanLimits;
};

// Code defaults — the seed + fallback. Admin edits (PlatformSetting.plans)
// override the display fields (name/price/features/priceId); limits always come
// from code so quota enforcement can't be misconfigured from the UI.
export function defaultPlanCatalog(): PlanCatalogEntry[] {
  return [
    {
      plan: "pro",
      name: "Pro",
      priceId: process.env.PADDLE_PRICE_PRO ?? null,
      priceMonthlyUsd: 70,
      priceIdYearly: process.env.PADDLE_PRICE_PRO_YEARLY ?? null,
      priceYearlyUsd: 588,
      features: ["3 websites", "2,000 AI messages / mo", "25 knowledge sources", "5 team members"],
      limits: PLAN_LIMITS.pro,
    },
    {
      plan: "business",
      name: "Business",
      priceId: process.env.PADDLE_PRICE_BUSINESS ?? null,
      priceMonthlyUsd: 199,
      priceIdYearly: process.env.PADDLE_PRICE_BUSINESS_YEARLY ?? null,
      priceYearlyUsd: 1671.6,
      features: ["10 websites", "20,000 AI messages / mo", "200 knowledge sources", "25 team members"],
      limits: PLAN_LIMITS.business,
    },
    {
      plan: "enterprise",
      name: "Enterprise",
      priceId: process.env.PADDLE_PRICE_ENTERPRISE ?? null,
      priceMonthlyUsd: 399,
      priceIdYearly: process.env.PADDLE_PRICE_ENTERPRISE_YEARLY ?? null,
      priceYearlyUsd: 3351.6,
      features: ["Unlimited websites", "Unlimited AI messages", "Unlimited knowledge", "Unlimited team"],
      limits: PLAN_LIMITS.enterprise,
    },
  ];
}

// Admin-editable plan overrides, stored on the PlatformSetting singleton.
export type PlanOverride = {
  plan: Plan;
  name?: string;
  priceMonthlyUsd?: number | null;
  priceYearlyUsd?: number | null;
  features?: string[];
  priceId?: string;
  priceIdYearly?: string;
};

// The effective catalog: code defaults with admin overrides applied. Limits are
// never overridden. Falls back to defaults when nothing is configured.
export async function loadPlanCatalog(): Promise<PlanCatalogEntry[]> {
  const defaults = defaultPlanCatalog();
  // Imported lazily to avoid a config→model import cycle at module load.
  const { PlatformSetting } = await import("../models/index.js");
  const settings = await PlatformSetting.findOne({ singleton: "global" })
    .select("plans")
    .lean();
  const overrides = (settings?.plans ?? []) as PlanOverride[];
  if (!overrides.length) return defaults;
  const byPlan = new Map(overrides.map((o) => [o.plan, o]));
  return defaults.map((d) => {
    const o = byPlan.get(d.plan);
    if (!o) return d;
    return {
      ...d,
      name: o.name ?? d.name,
      priceMonthlyUsd: o.priceMonthlyUsd === undefined ? d.priceMonthlyUsd : o.priceMonthlyUsd,
      priceYearlyUsd: o.priceYearlyUsd === undefined ? d.priceYearlyUsd : o.priceYearlyUsd,
      features: o.features && o.features.length ? o.features : d.features,
      priceId: o.priceId ?? d.priceId,
      priceIdYearly: o.priceIdYearly ?? d.priceIdYearly,
    };
  });
}

// Default USD spending caps per plan. 0 = no cap (unlimited).
// Admin can override these via PlatformSetting.budgetLimits.
export const DEFAULT_BUDGET_LIMITS: Record<
  Plan,
  { orgMonthlyLimitUsd: number; websiteMonthlyLimitUsd: number }
> = {
  pro: { orgMonthlyLimitUsd: 20, websiteMonthlyLimitUsd: 20 },
  business: { orgMonthlyLimitUsd: 50, websiteMonthlyLimitUsd: 50 },
  enterprise: { orgMonthlyLimitUsd: 100, websiteMonthlyLimitUsd: 100 },
};

// Fetch the effective budget limits for a plan (admin override or code defaults).
export async function budgetLimitsForPlan(
  plan: string | null | undefined,
): Promise<{ orgMonthlyLimitUsd: number; websiteMonthlyLimitUsd: number }> {
  if (!plan || !(plan in DEFAULT_BUDGET_LIMITS)) {
    return { orgMonthlyLimitUsd: 0, websiteMonthlyLimitUsd: 0 };
  }
  const { PlatformSetting } = await import("../models/index.js");
  const settings = await PlatformSetting.findOne({ singleton: "global" })
    .select("budgetLimits")
    .lean();
  const overrides = (settings?.budgetLimits ?? []) as Array<{
    plan: string;
    orgMonthlyLimitUsd: number;
    websiteMonthlyLimitUsd: number;
  }>;
  const override = overrides.find((o) => o.plan === plan);
  return override ?? DEFAULT_BUDGET_LIMITS[plan as Plan];
}

// Reverse map: Paddle price id → plan tier (covers both monthly and yearly).
export async function planByPriceId(): Promise<Record<string, Plan>> {
  const map: Record<string, Plan> = {};
  for (const entry of await loadPlanCatalog()) {
    if (entry.priceId) map[entry.priceId] = entry.plan;
    if (entry.priceIdYearly) map[entry.priceIdYearly] = entry.plan;
  }
  return map;
}
