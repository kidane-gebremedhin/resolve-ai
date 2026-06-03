import { api, ApiError } from '@/lib/api';
import { formatNumber } from '@/components/admin/utils';

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

async function load(): Promise<{ orgs: AdminOrg[]; error: string | null }> {
  try {
    const { items } = await api.get<{ items: AdminOrg[] }>('/admin/organizations?limit=100');
    return { orgs: items, error: null };
  } catch (err) {
    return { orgs: [], error: err instanceof ApiError ? err.message : 'Failed to load organizations' };
  }
}

export const dynamic = 'force-dynamic';

export default async function OrganizationsPage() {
  const { orgs, error } = await load();
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Organizations</h1>
      <p className="mt-1 text-sm text-muted-foreground">{formatNumber(orgs.length)} loaded · all tenants</p>
      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>
      ) : null}
      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
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
            {orgs.map((o) => (
              <tr key={o._id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-muted-foreground">{o.slug}</div>
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs capitalize">
                    {o.subscriptionPlan ?? o.plan ?? 'free'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">{formatNumber(o.memberCount)}</td>
                <td className="px-4 py-2.5 text-right">{formatNumber(o.conversationCount)}</td>
                <td className="px-4 py-2.5 text-right">{formatNumber(o.knowledgeSourceCount)}</td>
              </tr>
            ))}
            {orgs.length === 0 && !error ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No organizations yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
