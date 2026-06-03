import { api, ApiError } from '@/lib/api';
import { AnalyticsChart } from '@/components/analytics-chart';
import { InsightsPanel } from '@/components/insights-panel';
import type { TimeSeriesResponse } from '@/components/admin/utils';

async function series(metric: string): Promise<{ date: string; value: number }[]> {
  try {
    const res = await api.get<TimeSeriesResponse>(`/admin/timeseries?metric=${metric}&days=30`);
    return res.points;
  } catch {
    return [];
  }
}

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  let error: string | null = null;
  let signups: { date: string; value: number }[] = [];
  let conversations: { date: string; value: number }[] = [];
  let messages: { date: string; value: number }[] = [];
  try {
    [signups, conversations, messages] = await Promise.all([
      series('signups'),
      series('conversations'),
      series('messages'),
    ]);
  } catch (err) {
    error = err instanceof ApiError ? err.message : 'Failed to load analytics';
  }

  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last 30 days · across all tenants</p>
      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>
      ) : null}

      <div className="mt-6">
        <InsightsPanel />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Signups">
          <AnalyticsChart data={signups} color="#7c3aed" />
        </Card>
        <Card title="Conversations">
          <AnalyticsChart data={conversations} color="#0ea5e9" />
        </Card>
        <Card title="Messages">
          <AnalyticsChart data={messages} color="#10b981" />
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}
