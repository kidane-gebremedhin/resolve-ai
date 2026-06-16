import type { Metadata } from 'next';
import AffiliatesPageContent from '@/components/ns/pages/affiliates-page-content';

export const metadata: Metadata = {
  title: 'Affiliates',
  description: 'Earn recurring commission by referring businesses to the Chataxis AI customer support platform.',
};

export default function Page() {
  return <AffiliatesPageContent />;
}
