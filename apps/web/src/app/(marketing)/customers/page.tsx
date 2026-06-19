import type { Metadata } from 'next';
import CustomersPageContent from '@/components/site/customers-page-content';
import { APP_NAME } from '@/lib/app-config';

export const metadata: Metadata = {
  title: 'Customers',
  description: `How teams ship calmer support with ${APP_NAME}.`,
  openGraph: {
    title: `Customers | ${APP_NAME}`,
    description: `Real teams, real results with ${APP_NAME}.`,
  },
};

export default function Page() {
  return <CustomersPageContent />;
}
