'use client';

// Filter bar for the admin AI usage report. All state lives in the URL so the
// server component re-fetches on every change. Org and website option lists are
// passed in from the server to avoid client-side fetching.

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
} from '@csb/ui';

export type FilterOption = { value: string; label: string };

const ALL = '__all';

export function UsageFilters({
  period,
  from,
  to,
  organizationId,
  websiteId,
  orgOptions,
  websiteOptions,
}: {
  period: string;
  from: string;
  to: string;
  organizationId: string;
  websiteId: string;
  orgOptions: FilterOption[];
  websiteOptions: FilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    if (!value || value === ALL) sp.delete(key);
    else sp.set(key, value);
    // Resetting website filter when org changes
    if (key === 'organizationId') sp.delete('websiteId');
    router.push(`${pathname}?${sp.toString()}`);
  }

  function setDateParam(key: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value) {
      sp.set(key, value);
      sp.delete('period'); // date range overrides period
    } else {
      sp.delete(key);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  function clearAll() {
    router.push(pathname);
  }

  const hasFilters = period !== getCurrentPeriod() || from || to || organizationId || websiteId;

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Billing month */}
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Billing month
        <input
          type="month"
          value={from || to ? '' : period}
          onChange={(e) => {
            const sp = new URLSearchParams(params.toString());
            if (e.target.value) {
              sp.set('period', e.target.value);
              sp.delete('from');
              sp.delete('to');
            } else {
              sp.delete('period');
            }
            router.push(`${pathname}?${sp.toString()}`);
          }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>

      {/* Date range — overrides month picker */}
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        From date
        <Input
          type="date"
          className="h-9 w-[150px]"
          value={from}
          onChange={(e) => setDateParam('from', e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        To date
        <Input
          type="date"
          className="h-9 w-[150px]"
          value={to}
          onChange={(e) => setDateParam('to', e.target.value)}
        />
      </label>

      {/* Organization */}
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Organization
        <Select
          value={organizationId || ALL}
          onValueChange={(v) => setParam('organizationId', v)}
        >
          <SelectTrigger className="h-9 w-[180px] text-sm text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All organizations</SelectItem>
            {orgOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {/* Website */}
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Website
        <Select
          value={websiteId || ALL}
          onValueChange={(v) => setParam('websiteId', v)}
        >
          <SelectTrigger className="h-9 w-[180px] text-sm text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All websites</SelectItem>
            {websiteOptions.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {hasFilters && (
        <button
          onClick={clearAll}
          className="h-9 rounded-md px-3 text-sm text-muted-foreground hover:text-foreground transition"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
