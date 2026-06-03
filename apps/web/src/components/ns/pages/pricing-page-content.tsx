'use client';

import Pricing from '@/components/ns/homepage-34/Pricing';
import { LandingPageShell } from '@/components/ns/landing-page-shell';

type CatalogPlan = { plan: string; name: string; priceMonthlyUsd: number | null };

export default function PricingPageContent({ catalog = [] }: { catalog?: CatalogPlan[] }) {
  return (
    <LandingPageShell>
      <Pricing catalog={catalog} />
    </LandingPageShell>
  );
}
