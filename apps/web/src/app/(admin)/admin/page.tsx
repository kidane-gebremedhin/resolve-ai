// Platform-admin overview. Server component: fetches stats + a fresh page of
// users / subscriptions on every request (cache: no-store via api.get).
//
// Backed by the rewritten /admin/stats which now aggregates everything we
// previously surfaced as TODO badges (MRR, signup buckets, conversation
// buckets, KB source counts, churn).

import {
  ArrowUpRight,
  BookOpen,
  Building2,
  CreditCard,
  DollarSign,
  MessageSquare,
  TrendingDown,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  type AdminStats,
  type AdminSubscription,
  type AdminUser,
  type TimeSeriesResponse,
  EMPTY_ADMIN_STATS,
  formatCurrency,
  formatNumber,
  relativeTime,
} from "@/components/admin/utils";
import { Sparkline } from "@/components/charts";

async function loadOverview() {
  try {
    // The admin list endpoints return a paginated envelope ({ items, total, … }),
    // not a bare array — unwrap `.items` (matches the agents/organizations pages).
    const [stats, users, subs, signupsSeries] = await Promise.all([
      api.get<AdminStats>("/admin/stats"),
      api.get<{ items: AdminUser[] }>("/admin/users?limit=10"),
      api.get<{ items: AdminSubscription[] }>("/admin/subscriptions"),
      api.get<TimeSeriesResponse>("/admin/timeseries?metric=signups&days=30"),
    ]);
    return {
      stats,
      users: users.items,
      subs: subs.items,
      signupsSeries: signupsSeries.points,
      error: null as string | null,
    };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Failed to load admin data";
    return {
      stats: EMPTY_ADMIN_STATS,
      users: [] as AdminUser[],
      subs: [] as AdminSubscription[],
      signupsSeries: [] as TimeSeriesResponse["points"],
      error: message,
    };
  }
}

export default async function AdminOverviewPage() {
  const { stats, users, subs, signupsSeries, error } = await loadOverview();
  const recentSignups = [...users]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Platform health at a glance · {formatNumber(stats.totalOrganizations)} organizations
      </p>

      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        <KpiCard icon={Users} label="Total users" value={formatNumber(stats.totalUsers)} />
        <KpiCard
          icon={CreditCard}
          label="Active subscriptions"
          value={formatNumber(stats.activeSubscriptions)}
        />
        <KpiCard
          icon={DollarSign}
          label="MRR"
          value={formatCurrency(stats.mrr)}
          hint="Plan price × active/trialing"
        />
        <KpiCard
          icon={MessageSquare}
          label="Conversations (30d)"
          value={formatNumber(stats.conversations.month)}
          hint={`${formatNumber(stats.conversations.today)} today`}
        />
      </div>

      <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        <KpiCard
          icon={Building2}
          label="Organizations"
          value={formatNumber(stats.totalOrganizations)}
        />
        <KpiCard
          icon={BookOpen}
          label="Knowledge sources"
          value={formatNumber(stats.totalKnowledgeSources)}
        />
        <KpiCard
          icon={Users}
          label="Signups (7d)"
          value={formatNumber(stats.signups.week)}
          hint={`${formatNumber(stats.signups.today)} today`}
        />
        <KpiCard
          icon={TrendingDown}
          label="Churn (30d)"
          value={`${(stats.churnRate * 100).toFixed(1)}%`}
          hint="canceled ÷ (active + canceled)"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="font-display text-sm font-semibold">Subscription mix</div>
            <span className="text-xs text-muted-foreground">{subs.length} total</span>
          </div>
          <SubMixBars subs={subs} />
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="font-display text-sm font-semibold">Signups (30d)</div>
            <span className="text-xs text-muted-foreground">
              {formatNumber(stats.signups.month)} total
            </span>
          </div>
          <div className="mt-4 text-foreground">
            <Sparkline points={signupsSeries} height={56} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Daily signups over the last 30 days (UTC).
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-display text-sm font-semibold">Recent signups</div>
          <span className="text-xs text-muted-foreground">Last {recentSignups.length}</span>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">User</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Email</th>
              <th className="px-5 py-3 font-medium">Provider</th>
              <th className="px-5 py-3 font-medium text-right">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {recentSignups.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-12 text-center text-muted-foreground">
                  No users yet.
                </td>
              </tr>
            ) : (
              recentSignups.map((u) => (
                <tr key={u._id} className="hover:bg-surface">
                  <td className="px-5 py-3 font-medium">{u.name || "(no name)"}</td>
                  <td className="hidden px-5 py-3 text-muted-foreground md:table-cell">{u.email}</td>
                  <td className="px-5 py-3 capitalize">{u.provider}</td>
                  <td className="px-5 py-3 text-right text-muted-foreground">
                    {relativeTime(u.createdAt)} ago
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-card p-5">
      <div className="flex items-center justify-between text-muted-foreground">
        <Icon className="h-4 w-4" />
        {hint ? (
          <span className="inline-flex items-center gap-1 text-xs">
            <ArrowUpRight className="h-3 w-3" />
            {hint}
          </span>
        ) : null}
      </div>
      <div className="mt-3 font-display text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function SubMixBars({ subs }: { subs: AdminSubscription[] }) {
  const counts: Record<string, number> = {};
  for (const s of subs) counts[s.status] = (counts[s.status] ?? 0) + 1;
  const order: AdminSubscription["status"][] = ["active", "trialing", "past_due", "paused", "canceled"];
  const max = Math.max(1, ...order.map((k) => counts[k] ?? 0));
  return (
    <ul className="mt-4 space-y-2.5 text-sm">
      {order.map((k) => {
        const n = counts[k] ?? 0;
        const pct = (n / max) * 100;
        return (
          <li key={k}>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="text-foreground capitalize">{k.replace("_", " ")}</span>
              <span>{n}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
