import type { Metadata } from 'next';
import ContactPageContent from '@/components/ns/pages/contact-page-content';

export const metadata: Metadata = {
  title: 'Contact',
};

export default function Page() {
  return <ContactPageContent />;
}
