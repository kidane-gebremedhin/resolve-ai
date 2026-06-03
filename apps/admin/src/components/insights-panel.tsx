'use client';

import { useEffect, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2 } from 'lucide-react';
import { clientApi, ApiError } from '@/lib/api';

type Insights = {
  resolution: { aiResolved: number; operatorResolved: number; escalated: number; total: number };
  confidence: { average: number; count: number; buckets: { range: string; count: number }[] };
};

const BUCKET_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'];

export function InsightsPanel() {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clientApi
      .get<Insights>('/admin/insights')
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load insights'));
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading insights…
      </div>
    );
  }

  const { resolution: r, confidence: c } = data;
  const resolvedTotal = r.aiResolved + r.operatorResolved;
  const autoRate = resolvedTotal > 0 ? r.aiResolved / resolvedTotal : 0;
  // Proportion bar segments.
  const segTotal = r.aiResolved + r.operatorResolved + r.escalated || 1;
  const segs = [
    { label: 'AI auto-resolved', value: r.aiResolved, color: '#10b981' },
    { label: 'Operator-resolved', value: r.operatorResolved, color: '#0ea5e9' },
    { label: 'Escalated to human', value: r.escalated, color: '#f97316' },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Auto-resolution vs human escalation */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Resolution vs escalation</div>
          <div className="text-xs text-muted-foreground">{r.total} conversations</div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <div className="font-display text-3xl font-semibold">{Math.round(autoRate * 100)}%</div>
          <div className="text-xs text-muted-foreground">auto-resolved by AI (of resolved)</div>
        </div>
        <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted">
          {segs.map((s) => (
            <div key={s.label} style={{ width: `${(s.value / segTotal) * 100}%`, background: s.color }} title={`${s.label}: ${s.value}`} />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {segs.map((s) => (
            <div key={s.label} className="rounded-lg border border-border p-2.5">
              <div className="font-display text-lg font-semibold">{s.value}</div>
              <div className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Agent confidence */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Agent confidence</div>
          <div className="text-xs text-muted-foreground">{c.count} AI replies</div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <div className="font-display text-3xl font-semibold">{Math.round(c.average * 100)}%</div>
          <div className="text-xs text-muted-foreground">average confidence</div>
        </div>
        <div className="mt-3 h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={c.buckets} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <XAxis dataKey="range" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 10 }} width={32} allowDecimals={false} stroke="currentColor" className="text-muted-foreground" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {c.buckets.map((_, i) => (
                  <Cell key={i} fill={BUCKET_COLORS[i] ?? '#7c3aed'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
