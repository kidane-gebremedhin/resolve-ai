'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

const OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

export function UsageDaysFilter({ days }: { days: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setDays(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value === '30') sp.delete('days');
    else sp.set('days', value);
    router.push(`${pathname}${sp.toString() ? `?${sp.toString()}` : ''}`);
  }

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => setDays(o.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition ${
            days === o.value
              ? 'bg-foreground text-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
