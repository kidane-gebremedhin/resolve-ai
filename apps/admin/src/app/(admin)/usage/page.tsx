import { api, ApiError } from '@/lib/api';
import { planLabel } from '@/components/admin/utils';
import { UsageFilters, type FilterOption } from '@/components/admin/usage-filter';
import type { ListEnvelope } from '@/lib/list-params';

type UsageRow = {
  orgId: string;
  orgName: string;
  plan: string | null;
  websiteId: string | null;
  websiteName: string | null;
  websiteDomain: string | null;
  spentUsd: number;
  calls: number;
  tokens: number;
};

type AdminUsageResponse = {
  period?: string;
  from?: string;
  to?: string;
  totalCostUsd: number;
  totalTokens: number;
  rows: UsageRow[];
};

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function fmtUsd(v: number): string {
  return `$${v.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Load org and website option lists for the filter dropdowns.
async function loadFilterOptions(organizationId?: string): Promise<{
  orgs: FilterOption[];
  websites: FilterOption[];
}> {
  try {
    const qs = organizationId ? `?organizationId=${organizationId}` : '';
    const [orgs, websites] = await Promise.all([
      api.get<ListEnvelope<{ _id: string; name: string }>>('/admin/organizations?pageSize=200'),
      api.get<{ items: { _id: string; name: string; domain: string }[] }>(`/admin/usage/websites${qs}`),
    ]);
    return {
      orgs: orgs.items.map((o) => ({ value: o._id, label: o.name })),
      websites: websites.items.map((w) => ({
        value: w._id,
        label: w.name ? `${w.name} · ${w.domain}` : w.domain,
      })),
    };
  } catch {
    return { orgs: [], websites: [] };
  }
}

export const dynamic = 'force-dynamic';

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const period =
    typeof sp.period === 'string' && /^\d{4}-\d{2}$/.test(sp.period)
      ? sp.period
      : currentPeriod();
  const from = typeof sp.from === 'string' ? sp.from : '';
  const to = typeof sp.to === 'string' ? sp.to : '';
  const organizationId = typeof sp.organizationId === 'string' ? sp.organizationId : '';
  const websiteId = typeof sp.websiteId === 'string' ? sp.websiteId : '';

  // Build query string for the usage API.
  const qs = new URLSearchParams();
  if (from || to) {
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
  } else {
    qs.set('period', period);
  }
  if (organizationId) qs.set('organizationId', organizationId);
  if (websiteId) qs.set('websiteId', websiteId);

  const [{ orgs, websites }, usageResult] = await Promise.all([
    loadFilterOptions(organizationId || undefined),
    api
      .get<AdminUsageResponse>(`/admin/usage/cost?${qs.toString()}`)
      .then((d) => ({ data: d, error: null }))
      .catch((err) => ({
        data: null,
        error: err instanceof ApiError ? err.message : 'Failed to load usage.',
      })),
  ]);

  const data = usageResult.data;
  const error = usageResult.error;

  // Build period label for the subtitle.
  let periodDesc = '';
  if (from || to) {
    periodDesc = [from && `from ${from}`, to && `to ${to}`].filter(Boolean).join(' ');
  } else {
    const [year, month] = period.split('-');
    periodDesc = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  }

  return (
    <div className="container-page py-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">AI Usage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform-wide AI spending · {periodDesc}
        </p>
      </div>

      <div className="mt-4">
        <UsageFilters
          period={period}
          from={from}
          to={to}
          organizationId={organizationId}
          websiteId={websiteId}
          orgOptions={orgs}
          websiteOptions={websites}
        />
      </div>

      {error ? (
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Summary cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total spend
          </div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">
            {data ? fmtUsd(data.totalCostUsd) : '—'}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Estimated USD · {periodDesc}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total tokens
          </div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">
            {data ? fmtTokens(data.totalTokens) : '—'}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Combined input + output
          </div>
        </div>
      </div>

      {/* Usage breakdown table */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-semibold tracking-tight">Usage breakdown</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Top 50 rows by spend, grouped by organization and website.
        </p>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Organization</th>
              <th className="px-4 py-2.5 font-medium">Website</th>
              <th className="px-4 py-2.5 font-medium">Plan</th>
              <th className="px-4 py-2.5 font-medium text-right">Tokens</th>
              <th className="px-4 py-2.5 font-medium text-right">AI calls</th>
              <th className="px-4 py-2.5 font-medium text-right">Spend (USD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data && data.rows.length > 0 ? (
              data.rows.map((r, i) => (
                <tr key={`${r.orgId}-${r.websiteId ?? 'none'}`} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{r.orgName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.orgId.slice(-8)}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {r.websiteName || r.websiteDomain ? (
                      <>
                        <div className="font-medium">{r.websiteName ?? r.websiteDomain}</div>
                        {r.websiteName && r.websiteDomain && (
                          <div className="text-[11px] text-muted-foreground">{r.websiteDomain}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
                      {planLabel(r.plan)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">{fmtTokens(r.tokens)}</td>
                  <td className="px-4 py-2.5 text-right">{r.calls.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{fmtUsd(r.spentUsd)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {data ? 'No AI usage recorded for this period.' : 'Loading…'}
                </td>
              </tr>
            )}
          </tbody>
          {data && data.rows.length > 0 && (
            <tfoot className="border-t border-border bg-muted/30">
              <tr>
                <td colSpan={4} className="px-4 py-2.5 text-xs text-muted-foreground">
                  Total (shown rows)
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                  {fmtTokens(data.rows.reduce((s, r) => s + r.tokens, 0))}
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                  {data.rows.reduce((s, r) => s + r.calls, 0).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right text-sm font-semibold">
                  {fmtUsd(data.totalCostUsd)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
