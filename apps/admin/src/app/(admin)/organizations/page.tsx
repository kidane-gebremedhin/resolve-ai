import { api, ApiError } from '@/lib/api';
import { formatNumber, planLabel } from '@/components/admin/utils';
import { ListToolbar, FilterSelect } from '@/components/admin/list-toolbar';
import { buildListQuery, type ListEnvelope } from '@/lib/list-params';

type AdminOrg = {
  _id: string;
  name: string;
  slug: string;
  plan?: string;
  memberCount: number;
  conversationCount: number;
  knowledgeSourceCount: number;
  subscriptionPlan?: string;
  subscriptionStatus?: string;
};

const KEYS = ['q', 'from', 'to', 'plan', 'page', 'pageSize'] as const;

async function load(qs: string): Promise<ListEnvelope<AdminOrg> & { error: string | null }> {
  try {
    const d = await api.get<ListEnvelope<AdminOrg>>(`/admin/organizations${qs ? `?${qs}` : ''}`);
    return { ...d, error: null };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err; // propagate the /logout redirect on 401/403
    return { items: [], total: 0, page: 1, pageSize: 10, totalPages: 1, error: err.message };
  }
}

export const dynamic = 'force-dynamic';

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const data = await load(buildListQuery(sp, KEYS));
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Organizations</h1>
      <p className="mt-1 text-sm text-muted-foreground">{formatNumber(data.total)} total · all tenants</p>
      {data.error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{data.error}</div>
      ) : null}
      <div className="mt-6 space-y-4">
        <ListToolbar
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          totalPages={data.totalPages}
          searchPlaceholder="Search name or slug…"
          dateField="Created"
        >
          <FilterSelect
            param="plan"
            label="Plan"
            options={[
              { value: 'free', label: 'Free' },
              { value: 'starter', label: 'Basic' },
              { value: 'pro', label: 'Business' },
              { value: 'enterprise', label: 'Enterprise' },
            ]}
          />
        </ListToolbar>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Organization</th>
                <th className="px-4 py-2.5 font-medium">Plan</th>
                <th className="px-4 py-2.5 font-medium text-right">Members</th>
                <th className="px-4 py-2.5 font-medium text-right">Conversations</th>
                <th className="px-4 py-2.5 font-medium text-right">KB sources</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((o) => (
                <tr key={o._id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs text-muted-foreground">{o.slug}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
                      {planLabel(o.subscriptionPlan ?? o.plan ?? 'free')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatNumber(o.memberCount)}</td>
                  <td className="px-4 py-2.5 text-right">{formatNumber(o.conversationCount)}</td>
                  <td className="px-4 py-2.5 text-right">{formatNumber(o.knowledgeSourceCount)}</td>
                </tr>
              ))}
              {data.items.length === 0 && !data.error ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No organizations match these filters.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
