import { CampaignsManager } from '@/components/campaigns-manager';
import { api, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Campaign = Parameters<typeof CampaignsManager>[0]['initialCampaigns'];

// Fetched here rather than in the client component's mount effect, matching the
// pattern used by the settings page. A failed load renders the manager with an
// error banner instead of an empty list, so the two states stay distinguishable.
async function loadCampaigns(): Promise<{ items: Campaign; error: string | null }> {
  try {
    const { items } = await api.get<{ items: NonNullable<Campaign> }>('/admin/campaigns');
    return { items, error: null };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return { items: null, error: err.message };
  }
}

export default async function CampaignsPage() {
  const { items, error } = await loadCampaigns();
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Campaigns</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Create marketing campaigns with a tracking code. Share a signup link with{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">?campaign=&lt;code&gt;</code> — attributed
        signups and paid conversions show up here.
      </p>
      <CampaignsManager initialCampaigns={items} initialError={error} />
    </div>
  );
}
