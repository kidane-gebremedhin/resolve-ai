'use client';

// Time-range / metric / organization / agent filters for the admin Analytics
// page. State lives in the URL (?days=&metric=&organizationId=&agentId=) so the
// server component re-fetches the time series; this is a thin client control
// that pushes those params. Org/agent option lists are passed in from the server.

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@csb/ui';
import { RANGE_OPTIONS, METRIC_OPTIONS } from './analytics-options';

export type FilterOption = { value: string; label: string };

const ALL = '__all';

export function AnalyticsFilters({
  days,
  metric,
  organizationId,
  agentId,
  orgOptions,
  agentOptions,
}: {
  days: string;
  metric: string;
  organizationId: string;
  agentId: string;
  orgOptions: FilterOption[];
  agentOptions: FilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value === ALL || !value) sp.delete(key);
    else sp.set(key, value);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Time range
        <Select value={days} onValueChange={(v) => setParam('days', v)}>
          <SelectTrigger className="h-9 w-[150px] text-sm text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Metric
        <Select value={metric} onValueChange={(v) => setParam('metric', v)}>
          <SelectTrigger className="h-9 w-[150px] text-sm text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRIC_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Organization
        <Select
          value={organizationId || ALL}
          onValueChange={(v) => setParam('organizationId', v)}
        >
          <SelectTrigger className="h-9 w-[170px] text-sm text-foreground">
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
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Agent
        <Select value={agentId || ALL} onValueChange={(v) => setParam('agentId', v)}>
          <SelectTrigger className="h-9 w-[170px] text-sm text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All agents</SelectItem>
            {agentOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
