import type { Metadata } from 'next';
import FeaturesPageContent from '@/components/ns/pages/features-page-content';
import { APP_NAME } from '@/lib/app-config';

export const metadata: Metadata = {
  title: 'Features',
  description: `Explore the full ${APP_NAME} platform features.`,
};

export default function Page() {
  return <FeaturesPageContent />;
}
