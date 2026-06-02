import type { Metadata } from 'next';
import PricingPageContent from '@/components/ns/pages/pricing-page-content';

// Root layout's title.template prepends "${APP_NAME}", so just the page name here.
export const metadata: Metadata = {
  title: 'Pricing',
};

export default function Page() {
  return <PricingPageContent />;
}
