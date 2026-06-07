'use client';

import { Quote } from 'lucide-react';
import { MarketingShell } from '@/components/site/MarketingShell';
import { APP_NAME } from '@/lib/app-config';

const stories = [
  {
    co: 'Northwind',
    industry: 'B2B SaaS',
    quote: 'We deflected 71% of tier-1 tickets in the first month. CSAT went up.',
    who: 'Maya Okafor, VP Support',
    metric: '−43%',
    metricLabel: 'median handle time',
  },
  {
    co: 'Lumen Health',
    industry: 'Healthcare',
    quote: `${APP_NAME} handles intake at 3am so our nurses don't have to. Game-changing.`,
    who: 'Dr. Idris Khan, COO',
    metric: '24/7',
    metricLabel: 'automated triage',
  },
  {
    co: 'Routebound',
    industry: 'Logistics',
    quote: 'Replaced Zendesk + Intercom + a homegrown bot in one weekend.',
    who: 'Anya Petrov, Head of CX',
    metric: '3 → 1',
    metricLabel: 'tools consolidated',
  },
  {
    co: 'Petalwise',
    industry: 'DTC',
    quote: 'Our agents stopped copy-pasting and started actually talking to customers.',
    who: 'Sam Reyes, Support Lead',
    metric: '+18',
    metricLabel: 'NPS in Q1',
  },
];

export default function CustomersPageContent() {
  return (
    <MarketingShell>
      <section className="border-b border-border">
        <div className="container-page py-20">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">Customers</div>
          <h1 className="mt-3 max-w-3xl text-balance font-display text-4xl font-semibold tracking-tight md:text-5xl">
            Teams shipping calmer support with {APP_NAME}.
          </h1>
        </div>
      </section>

      <section>
        <div className="container-page grid gap-px overflow-hidden border-b border-border bg-border md:grid-cols-2">
          {stories.map((s) => (
            <article key={s.co} className="flex flex-col gap-6 bg-card p-8">
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-semibold">{s.co}</span>
                <span className="text-xs text-muted-foreground">{s.industry}</span>
              </div>
              <Quote className="h-5 w-5 text-primary" />
              <p className="font-display text-xl leading-snug tracking-tight">&quot;{s.quote}&quot;</p>
              <div className="mt-auto flex items-end justify-between border-t border-border pt-5">
                <div className="text-sm text-muted-foreground">{s.who}</div>
                <div className="text-right">
                  <div className="font-display text-2xl font-semibold tracking-tight">{s.metric}</div>
                  <div className="text-xs text-muted-foreground">{s.metricLabel}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
