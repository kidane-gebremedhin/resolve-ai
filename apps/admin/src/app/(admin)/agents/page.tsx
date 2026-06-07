import { api, ApiError } from '@/lib/api';
import { formatNumber } from '@/components/admin/utils';
import { ListToolbar, FilterSelect } from '@/components/admin/list-toolbar';
import { buildListQuery, type ListEnvelope } from '@/lib/list-params';

type AdminAgent = {
  _id: string;
  name: string;
  model?: string;
  isActive?: boolean;
  organizationName?: string;
  websiteDomain?: string;
  conversationCount: number;
};

// organizationId / websiteId are also honored by the API (URL-driven); the UI
// exposes search, an active/inactive filter, and date range here.
const KEYS = ['q', 'from', 'to', 'active', 'organizationId', 'websiteId', 'page', 'pageSize'] as const;

async function load(qs: string): Promise<ListEnvelope<AdminAgent> & { error: string | null }> {
  try {
    const d = await api.get<ListEnvelope<AdminAgent>>(`/admin/agents${qs ? `?${qs}` : ''}`);
    return { ...d, error: null };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err; // propagate the /logout redirect on 401/403
    return { items: [], total: 0, page: 1, pageSize: 10, totalPages: 1, error: err.message };
  }
}

export const dynamic = 'force-dynamic';

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const data = await load(buildListQuery(sp, KEYS));
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Agents</h1>
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
          searchPlaceholder="Search agent name…"
          dateField="Created"
        >
          <FilterSelect
            param="active"
            label="Status"
            options={[
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ]}
          />
        </ListToolbar>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Agent</th>
                <th className="px-4 py-2.5 font-medium">Organization</th>
                <th className="px-4 py-2.5 font-medium">Website</th>
                <th className="px-4 py-2.5 font-medium">Model</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Conversations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((a) => (
                <tr key={a._id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{a.name}</td>
                  <td className="px-4 py-2.5">{a.organizationName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.websiteDomain ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.model ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-md px-1.5 py-0.5 text-xs ${a.isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                      {a.isActive ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatNumber(a.conversationCount)}</td>
                </tr>
              ))}
              {data.items.length === 0 && !data.error ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No agents match these filters.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
