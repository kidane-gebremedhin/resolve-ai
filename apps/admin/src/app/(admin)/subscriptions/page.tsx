import { api, ApiError } from '@/lib/api';
import { SubscriptionsTable } from '@/components/admin/subscriptions-filter';
import type { AdminSubscription } from '@/components/admin/utils';
import { formatCurrency } from '@/components/admin/utils';
import { ListToolbar, FilterSelect } from '@/components/admin/list-toolbar';
import { buildListQuery, type ListEnvelope } from '@/lib/list-params';

type SubsEnvelope = ListEnvelope<AdminSubscription> & { mrr: number };

const KEYS = ['q', 'from', 'to', 'plan', 'status', 'page', 'pageSize'] as const;

async function load(qs: string): Promise<SubsEnvelope & { error: string | null }> {
  try {
    const d = await api.get<SubsEnvelope>(`/admin/subscriptions${qs ? `?${qs}` : ''}`);
    return { ...d, error: null };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err; // propagate the /logout redirect on 401/403
    return { items: [], total: 0, page: 1, pageSize: 10, totalPages: 1, mrr: 0, error: err.message };
  }
}

export const dynamic = 'force-dynamic';

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const data = await load(buildListQuery(sp, KEYS));
  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.total} records · {formatCurrency(data.mrr)} MRR
          </p>
        </div>
      </div>
      {data.error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{data.error}</div>
      ) : null}
      <div className="mt-6 space-y-4">
        <ListToolbar
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          totalPages={data.totalPages}
          searchPlaceholder="Search Paddle IDs…"
          dateField="Created"
        >
          <FilterSelect
            param="plan"
            label="Plan"
            options={[
              { value: 'starter', label: 'Basic' },
              { value: 'pro', label: 'Business' },
              { value: 'enterprise', label: 'Enterprise' },
            ]}
          />
          <FilterSelect
            param="status"
            label="Status"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'trialing', label: 'Trialing' },
              { value: 'past_due', label: 'Past due' },
              { value: 'canceled', label: 'Canceled' },
              { value: 'paused', label: 'Paused' },
            ]}
          />
        </ListToolbar>
        <SubscriptionsTable subscriptions={data.items} />
      </div>
    </div>
  );
}
