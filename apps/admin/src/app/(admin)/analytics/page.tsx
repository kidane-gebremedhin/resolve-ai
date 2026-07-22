import { api, ApiError } from '@/lib/api';
import { AnalyticsChart } from '@/components/analytics-chart';
import { InsightsPanel } from '@/components/insights-panel';
import { AnalyticsFilters, type FilterOption } from '@/components/admin/analytics-filter';
import { RANGE_OPTIONS, METRIC_OPTIONS } from '@/components/admin/analytics-options';
import type { ListEnvelope } from '@/lib/list-params';
import type { TimeSeriesResponse } from '@/components/admin/utils';

async function series(
  metric: string,
  days: number,
  scope: { organizationId?: string; agentId?: string },
): Promise<{ date: string; value: number }[]> {
  try {
    const qs = new URLSearchParams({ metric, days: String(days) });
    if (scope.organizationId) qs.set('organizationId', scope.organizationId);
    if (scope.agentId) qs.set('agentId', scope.agentId);
    const res = await api.get<TimeSeriesResponse>(`/admin/timeseries?${qs.toString()}`);
    return res.points;
  } catch {
    return [];
  }
}

// Option lists for the org/agent dropdowns. Best-effort — an error just yields
// an empty list (the "All" choice still works). When an org is selected, the agent
// list is scoped to THAT org so the Agent dropdown only shows its agents.
async function loadFilterOptions(organizationId?: string): Promise<{
  orgs: FilterOption[];
  agents: FilterOption[];
}> {
  try {
    const agentsQs = organizationId
      ? `?organizationId=${organizationId}&pageSize=200`
      : '?pageSize=200';
    const [orgs, agents] = await Promise.all([
      api.get<ListEnvelope<{ _id: string; name: string }>>('/admin/organizations?pageSize=200'),
      api.get<ListEnvelope<{ _id: string; name: string; organizationName?: string }>>(
        `/admin/agents${agentsQs}`,
      ),
    ]);
    return {
      orgs: orgs.items.map((o) => ({ value: o._id, label: o.name })),
      agents: agents.items.map((a) => ({
        value: a._id,
        label: a.organizationName ? `${a.name} · ${a.organizationName}` : a.name,
      })),
    };
  } catch {
    return { orgs: [], agents: [] };
  }
}

const VALID_DAYS = new Set<string>(RANGE_OPTIONS.map((o) => o.value));
const VALID_METRICS = new Set<string>(METRIC_OPTIONS.map((o) => o.value));
const isObjectId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const daysParam = typeof sp.days === 'string' && VALID_DAYS.has(sp.days) ? sp.days : '30';
  const metric = typeof sp.metric === 'string' && VALID_METRICS.has(sp.metric) ? sp.metric : 'all';
  const organizationId = isObjectId(sp.organizationId) ? sp.organizationId : '';
  const agentId = isObjectId(sp.agentId) ? sp.agentId : '';
  const days = Number(daysParam);
  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === daysParam)?.label ?? 'Last 30 days';
  const scope = {
    organizationId: organizationId || undefined,
    agentId: agentId || undefined,
  };

  const want = (m: string) => metric === 'all' || metric === m;

  const { orgs, agents } = await loadFilterOptions(organizationId || undefined);

  let error: string | null = null;
  let signups: { date: string; value: number }[] = [];
  let conversations: { date: string; value: number }[] = [];
  let messages: { date: string; value: number }[] = [];
  try {
    [signups, conversations, messages] = await Promise.all([
      want('signups') ? series('signups', days, scope) : Promise.resolve([]),
      want('conversations') ? series('conversations', days, scope) : Promise.resolve([]),
      want('messages') ? series('messages', days, scope) : Promise.resolve([]),
    ]);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err; // propagate the /logout redirect on 401/403
    error = err.message;
  }

  const scopeLabel = [
    organizationId ? orgs.find((o) => o.value === organizationId)?.label : null,
    agentId ? agents.find((a) => a.value === agentId)?.label : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="container-page py-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rangeLabel} · {scopeLabel || 'across all tenants'}
        </p>
      </div>
      {/* Filters on their own row so a longer subtitle (when an org/agent is
          selected) can't push them onto a new line. */}
      <div className="mt-4">
        <AnalyticsFilters
          days={daysParam}
          metric={metric}
          organizationId={organizationId}
          agentId={agentId}
          orgOptions={orgs}
          agentOptions={agents}
        />
      </div>
      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>
      ) : null}

      <div className="mt-6">
        <InsightsPanel />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {want('signups') && (
          <Card title="Signups">
            <AnalyticsChart data={signups} color="#7c3aed" />
          </Card>
        )}
        {want('conversations') && (
          <Card title="Conversations">
            <AnalyticsChart data={conversations} color="#0ea5e9" />
          </Card>
        )}
        {want('messages') && (
          <Card title="Messages">
            <AnalyticsChart data={messages} color="#10b981" />
          </Card>
        )}
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
