// Shared helpers used by admin pages. Server-importable: no client-only APIs.

export const PLAN_PRICES: Record<string, number> = {
  starter: 29,
  pro: 99,
  enterprise: 499,
};

export type AdminStats = {
  // Extended shape returned by the rewritten /admin/stats endpoint. Older
  // aliases (organizations, users) are kept for back-compat with snippets that
  // still read them.
  totalUsers: number;
  totalOrganizations: number;
  activeSubscriptions: number;
  totalConversations: number;
  totalKnowledgeSources: number;
  mrr: number;
  signups: { today: number; week: number; month: number };
  conversations: { today: number; week: number; month: number };
  churnRate: number;
  // Aliases (deprecated): same as totalOrganizations / totalUsers.
  organizations: number;
  users: number;
};

export type TimeSeriesPoint = { date: string; value: number };
export type TimeSeriesResponse = { points: TimeSeriesPoint[] };

export const EMPTY_ADMIN_STATS: AdminStats = {
  totalUsers: 0,
  totalOrganizations: 0,
  activeSubscriptions: 0,
  totalConversations: 0,
  totalKnowledgeSources: 0,
  mrr: 0,
  signups: { today: 0, week: 0, month: 0 },
  conversations: { today: 0, week: 0, month: 0 },
  churnRate: 0,
  organizations: 0,
  users: 0,
};

export type AdminUser = {
  _id: string;
  email: string;
  name: string;
  role: "user" | "platform_admin";
  provider: "credentials" | "google";
  createdAt: string;
  lastLoginAt?: string;
};

export type AdminSubscription = {
  _id: string;
  organizationId: string;
  paddleSubscriptionId: string;
  paddleCustomerId: string;
  plan: "starter" | "pro" | "enterprise";
  status: "active" | "trialing" | "past_due" | "canceled" | "paused";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  canceledAt?: string;
  trialEndAt?: string;
  createdAt: string;
  updatedAt: string;
};

export function planPrice(plan: string): number {
  return PLAN_PRICES[plan] ?? 0;
}

export function computeMrr(subs: AdminSubscription[]): number {
  return subs
    .filter((s) => s.status === "active" || s.status === "trialing")
    .reduce((sum, s) => sum + planPrice(s.plan), 0);
}

export function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toLocaleString()}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatDate(value?: string | Date): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function relativeTime(value?: string | Date): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(mo / 12)}y`;
}
