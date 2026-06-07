import { CampaignsManager } from '@/components/campaigns-manager';

export const dynamic = 'force-dynamic';

export default function CampaignsPage() {
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Campaigns</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Create marketing campaigns with a tracking code. Share a signup link with{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">?campaign=&lt;code&gt;</code> — attributed
        signups and paid conversions show up here.
      </p>
      <CampaignsManager />
    </div>
  );
}
