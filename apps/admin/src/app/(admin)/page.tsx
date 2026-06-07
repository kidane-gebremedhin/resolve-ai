import { api, ApiError } from '@/lib/api';
import { formatNumber } from '@/components/admin/utils';

type Stats = {
  totalUsers: number;
  totalOrganizations: number;
  activeSubscriptions: number;
  totalConversations: number;
  totalKnowledgeSources: number;
  mrr: number;
  churnRate: number;
};

async function load(): Promise<{ stats: Stats | null; error: string | null }> {
  try {
    return { stats: await api.get<Stats>('/admin/stats'), error: null };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err; // propagate the /logout redirect on 401/403
    return { stats: null, error: err.message };
  }
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1.5 font-display text-2xl font-semibold">{value}</div>
    </div>
  );
}

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const { stats, error } = await load();
  return (
    <div className="container-page py-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Platform-wide health across all tenants.</p>
      </div>

      {error ? (
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Organizations" value={formatNumber(stats?.totalOrganizations ?? 0)} />
        <Kpi label="Users" value={formatNumber(stats?.totalUsers ?? 0)} />
        <Kpi label="Active subscriptions" value={formatNumber(stats?.activeSubscriptions ?? 0)} />
        <Kpi label="MRR" value={`$${formatNumber(Math.round(stats?.mrr ?? 0))}`} />
        <Kpi label="Conversations" value={formatNumber(stats?.totalConversations ?? 0)} />
        <Kpi label="Knowledge sources" value={formatNumber(stats?.totalKnowledgeSources ?? 0)} />
        <Kpi label="Churn (30d)" value={`${Math.round((stats?.churnRate ?? 0) * 100)}%`} />
      </div>
    </div>
  );
}
