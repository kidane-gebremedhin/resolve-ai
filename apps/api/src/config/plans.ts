// Single source of truth for subscription plans: limits, display prices, and
// the Paddle price IDs (from env). Both quota enforcement
// (plan-limit.middleware) and the billing/pricing UIs (GET /billing/plans) read
// from here so limits, prices, and price IDs never drift apart.

export type Plan = "free" | "starter" | "pro" | "enterprise";

export type PlanLimits = {
  messagesPerMonth: number;
  knowledgeSources: number;
  websites: number;
  teamMembers: number;
};

const INF = Number.POSITIVE_INFINITY;

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { messagesPerMonth: 200, knowledgeSources: 5, websites: 1, teamMembers: 2 },
  starter: { messagesPerMonth: 2_000, knowledgeSources: 25, websites: 3, teamMembers: 5 },
  pro: { messagesPerMonth: 20_000, knowledgeSources: 200, websites: 10, teamMembers: 25 },
  enterprise: {
    messagesPerMonth: INF,
    knowledgeSources: INF,
    websites: INF,
    teamMembers: INF,
  },
};

export function limitsForPlan(plan: string | undefined): PlanLimits {
  const key = (plan ?? "free") as Plan;
  return PLAN_LIMITS[key] ?? PLAN_LIMITS.free;
}

export type PlanCatalogEntry = {
  plan: Plan;
  name: string;
  /** Paddle price id (env-configured); null for free / unconfigured. */
  priceId: string | null;
  /** Display price in USD/month; null = "custom". */
  priceMonthlyUsd: number | null;
  features: string[];
  limits: PlanLimits;
};

// Code defaults — the seed + fallback. Admin edits (PlatformSetting.plans)
// override the display fields (name/price/features/priceId); limits always come
// from code so quota enforcement can't be misconfigured from the UI.
export function defaultPlanCatalog(): PlanCatalogEntry[] {
  // No Free tier — every customer subscribes to a paid plan. `free` remains an
  // internal Organization.plan value meaning "unpaid / no active subscription",
  // and PLAN_LIMITS.free is the fallback, but it is never a purchasable plan.
  return [
    {
      plan: "starter",
      name: "Starter",
      priceId: process.env.PADDLE_PRICE_STARTER ?? null,
      priceMonthlyUsd: 19,
      features: ["3 websites", "2,000 AI messages / mo", "25 knowledge sources", "5 team members"],
      limits: PLAN_LIMITS.starter,
    },
    {
      plan: "pro",
      name: "Pro",
      priceId: process.env.PADDLE_PRICE_PRO ?? null,
      priceMonthlyUsd: 99,
      features: ["10 websites", "20,000 AI messages / mo", "200 knowledge sources", "25 team members"],
      limits: PLAN_LIMITS.pro,
    },
    {
      plan: "enterprise",
      name: "Enterprise",
      priceId: process.env.PADDLE_PRICE_ENTERPRISE ?? null,
      priceMonthlyUsd: 199,
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
  features?: string[];
  priceId?: string;
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
      features: o.features && o.features.length ? o.features : d.features,
      priceId: o.priceId ?? d.priceId,
    };
  });
}

// Reverse map: Paddle price id → plan tier (used by the webhook handler).
export async function planByPriceId(): Promise<Record<string, Plan>> {
  const map: Record<string, Plan> = {};
  for (const entry of await loadPlanCatalog()) {
    if (entry.priceId) map[entry.priceId] = entry.plan;
  }
  return map;
}
