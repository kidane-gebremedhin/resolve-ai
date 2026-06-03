import { api, ApiError } from '@/lib/api';
import { SubscriptionsFilter } from '@/components/admin/subscriptions-filter';
import type { AdminSubscription } from '@/components/admin/utils';
import { computeMrr, formatCurrency } from '@/components/admin/utils';

async function load(): Promise<{ subs: AdminSubscription[]; orgNameById: Record<string, string>; error: string | null }> {
  try {
    const [subs, orgsRes] = await Promise.all([
      api.get<AdminSubscription[]>('/admin/subscriptions'),
      api.get<{ items: { _id: string; name: string }[] }>('/admin/organizations?limit=100'),
    ]);
    const orgNameById: Record<string, string> = {};
    for (const o of orgsRes.items) orgNameById[o._id] = o.name;
    return { subs, orgNameById, error: null };
  } catch (err) {
    return { subs: [], orgNameById: {}, error: err instanceof ApiError ? err.message : 'Failed to load subscriptions' };
  }
}

export const dynamic = 'force-dynamic';

export default async function SubscriptionsPage() {
  const { subs, orgNameById, error } = await load();
  const mrr = computeMrr(subs);
  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {subs.length} records · {formatCurrency(mrr)} MRR
          </p>
        </div>
      </div>
      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>
      ) : null}
      <div className="mt-6">
        <SubscriptionsFilter subscriptions={subs} orgNameById={orgNameById} />
      </div>
    </div>
  );
}
