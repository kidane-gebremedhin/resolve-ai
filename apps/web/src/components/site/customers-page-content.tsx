'use client';

import { MessagesSquare, Clock, Layers, Sparkles } from 'lucide-react';
import { MarketingShell } from '@/components/site/MarketingShell';
import { APP_NAME } from '@/lib/app-config';

// Honest, capability-based use cases — NOT fabricated customer testimonials, quotes, logos, or
// metrics. Replace this section with real case studies once you have customers who agree to be
// featured.
const useCases = [
  {
    icon: MessagesSquare,
    title: 'Deflect repetitive questions',
    body: `Let ${APP_NAME} handle the FAQs, order-status checks, and how-tos, so your team only sees the conversations that truly need a person.`,
  },
  {
    icon: Clock,
    title: 'Answer around the clock',
    body: 'Customers get accurate, sourced answers instantly, day or night, and in their own language, without waiting for business hours.',
  },
  {
    icon: Layers,
    title: 'Consolidate your support stack',
    body: 'A grounded AI agent, a shared inbox, and built-in analytics in one place, so you can retire the patchwork of bots and tools.',
  },
  {
    icon: Sparkles,
    title: 'Keep agents focused',
    body: 'AI-drafted replies and one-click actions mean less copy-pasting and more real conversations with customers.',
  },
];

export default function CustomersPageContent() {
  return (
    <MarketingShell>
      <section className="border-b border-border">
        <div className="container-page py-20">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">Use cases</div>
          <h1 className="mt-3 max-w-3xl text-balance font-display text-4xl font-semibold tracking-tight md:text-5xl">
            What teams build with {APP_NAME}.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            From startups to established support teams, {APP_NAME} takes the repetitive load off your
            inbox so your people can focus on the conversations that matter.
          </p>
        </div>
      </section>

      <section>
        <div className="container-page grid gap-px overflow-hidden border-b border-border bg-border md:grid-cols-2">
          {useCases.map((u) => (
            <article key={u.title} className="flex flex-col gap-4 bg-card p-8">
              <u.icon className="h-6 w-6 text-primary" />
              <h2 className="font-display text-xl font-semibold tracking-tight">{u.title}</h2>
              <p className="text-muted-foreground">{u.body}</p>
            </article>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
