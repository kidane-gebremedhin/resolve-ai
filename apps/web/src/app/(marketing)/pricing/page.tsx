import type { Metadata } from 'next';
import PricingPageContent from '@/components/ns/pages/pricing-page-content';
import { API_URL } from '@/lib/app-urls';

// Root layout's title.template prepends "${APP_NAME}", so just the page name here.
export const metadata: Metadata = {
  title: 'Pricing',
};

export type CatalogPlan = {
  plan: string;
  name: string;
  priceMonthlyUsd: number | null;
  priceYearlyUsd: number | null;
};

// Admin-configured plan catalog (GET /billing/plans, public). The marketing
// template's name + price are overridden from this; its feature matrix is kept.
async function getCatalog(): Promise<CatalogPlan[]> {
  try {
    const res = await fetch(`${API_URL}/billing/plans`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const data = (await res.json()) as { plans?: CatalogPlan[] };
    return data.plans ?? [];
  } catch {
    return [];
  }
}

export default async function Page() {
  const catalog = await getCatalog();
  return <PricingPageContent catalog={catalog} />;
}
