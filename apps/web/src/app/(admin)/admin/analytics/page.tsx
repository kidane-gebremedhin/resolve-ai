// Platform-admin analytics page. Server component: pulls /admin/stats and the
// time-series endpoints to render real KPIs and daily charts.
//
// What still uses derived data:
//   - LTV proxy — naïve estimate (MRR ÷ active count × 12). Real LTV needs
//     historical revenue per customer and isn't aggregated yet.
//   - mrr_snapshot — flat baseline (today's MRR), because we don't persist
//     historical revenue. Series renders for visual continuity only.

import {
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
  type TimeSeriesResponse,
  EMPTY_ADMIN_STATS,
  formatCurrency,
  formatNumber,
} from "@/components/admin/utils";
import { BarChart, Sparkline } from "@/components/charts";

async function loadAnalytics() {
  try {
    const [stats, subs, signupsTs, conversationsTs, messagesTs] = await Promise.all([
      api.get<AdminStats>("/admin/stats"),
      // /admin/subscriptions returns a paginated envelope ({ items, … }); unwrap it.
      api.get<{ items: AdminSubscription[] }>("/admin/subscriptions"),
      api.get<TimeSeriesResponse>("/admin/timeseries?metric=signups&days=30"),
      api.get<TimeSeriesResponse>("/admin/timeseries?metric=conversations&days=30"),
      api.get<TimeSeriesResponse>("/admin/timeseries?metric=messages&days=30"),
    ]);
    return {
      stats,
      subs: subs.items,
      signupsTs: signupsTs.points,
      conversationsTs: conversationsTs.points,
      messagesTs: messagesTs.points,
      error: null as string | null,
    };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Failed to load analytics";
    return {
      stats: EMPTY_ADMIN_STATS,
      subs: [] as AdminSubscription[],
      signupsTs: [] as TimeSeriesResponse["points"],
      conversationsTs: [] as TimeSeriesResponse["points"],
      messagesTs: [] as TimeSeriesResponse["points"],
      error: message,
    };
  }
}

export default async function AdminAnalyticsPage() {
  const { stats, subs, signupsTs, conversationsTs, messagesTs, error } = await loadAnalytics();
  const mrr = stats.mrr;
  const arr = mrr * 12;
  const churnPct = stats.churnRate * 100;
  const ltvProxy = stats.activeSubscriptions > 0 ? (mrr / stats.activeSubscriptions) * 12 : 0;

  const statusCounts: Record<string, number> = {};
  for (const s of subs) statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
  const statusOrder: AdminSubscription["status"][] = [
    "active",
    "trialing",
    "past_due",
    "paused",
    "canceled",
  ];
  const statusMax = Math.max(1, ...statusOrder.map((k) => statusCounts[k] ?? 0));

  const canceledLast30 = Math.round(
    stats.churnRate * (stats.activeSubscriptions + (statusCounts.canceled ?? 0)),
  );

  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Platform analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Growth, retention, and revenue posture across the platform.
      </p>

      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        <KpiCard icon={Users} label="Total users" value={formatNumber(stats.totalUsers)} />
        <KpiCard
          icon={Building2}
          label="Organizations"
          value={formatNumber(stats.totalOrganizations)}
        />
        <KpiCard
          icon={CreditCard}
          label="Active subscriptions"
          value={formatNumber(stats.activeSubscriptions)}
        />
        <KpiCard
          icon={DollarSign}
          label="ARR (estimated)"
          value={formatCurrency(arr)}
          hint={`${formatCurrency(mrr)} MRR × 12`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">Signups</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Counted server-side from User.createdAt (UTC day buckets).
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <SignupCell label="Today" value={stats.signups.today} />
            <SignupCell label="Last 7d" value={stats.signups.week} />
            <SignupCell label="Last 30d" value={stats.signups.month} />
          </div>
          <div className="mt-5 text-foreground">
            <Sparkline points={signupsTs} height={56} />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">Retention</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Snapshot churn from canceled subs in the last 30 days.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <TrendingDown className="h-3.5 w-3.5" />
                <span className="text-xs">Churn rate (30d)</span>
              </div>
              <div className="mt-1 font-display text-2xl font-semibold">
                {churnPct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-muted-foreground">
                ~{Math.max(canceledLast30, 0)} canceled / {stats.activeSubscriptions} active
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <DollarSign className="h-3.5 w-3.5" />
                <span className="text-xs">LTV proxy</span>
              </div>
              <div className="mt-1 font-display text-2xl font-semibold">
                {formatCurrency(ltvProxy)}
              </div>
              <div className="text-[11px] text-muted-foreground">MRR ÷ active × 12</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="font-display text-sm font-semibold">Conversations (30d)</div>
            <div className="text-xs text-muted-foreground">
              {formatNumber(stats.conversations.month)} this month
            </div>
          </div>
          <div className="mt-4 text-foreground">
            <BarChart points={conversationsTs} height={160} valueLabel="conversations per day" />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-display text-sm font-semibold">
              <MessageSquare className="h-4 w-4" />
              Messages (30d)
            </div>
          </div>
          <div className="mt-4 text-foreground">
            <BarChart points={messagesTs} height={160} valueLabel="messages per day" />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">Subscription status mix</div>
          <ul className="mt-4 space-y-2.5 text-sm">
            {statusOrder.map((k) => {
              const n = statusCounts[k] ?? 0;
              const pct = (n / statusMax) * 100;
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
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-display text-sm font-semibold">
              <MessageSquare className="h-4 w-4" />
              Feature usage
            </div>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Conversations (today)</dt>
              <dd className="font-medium">{formatNumber(stats.conversations.today)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Conversations (7d)</dt>
              <dd className="font-medium">{formatNumber(stats.conversations.week)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Conversations (30d)</dt>
              <dd className="font-medium">{formatNumber(stats.conversations.month)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Knowledge sources</dt>
              <dd className="font-medium">{formatNumber(stats.totalKnowledgeSources)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Conversations (total)</dt>
              <dd className="font-medium">{formatNumber(stats.totalConversations)}</dd>
            </div>
          </dl>
        </div>
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
        {hint ? <span className="text-xs">{hint}</span> : null}
      </div>
      <div className="mt-3 font-display text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function SignupCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{formatNumber(value)}</div>
    </div>
  );
}
