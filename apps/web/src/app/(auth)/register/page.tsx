import type { Metadata } from 'next';
import SignupPageContent from '@/components/ns/pages/signup-page-content';

export const metadata: Metadata = {
  title: 'Sign up',
};

export default function Page() {
  return <SignupPageContent />;
}
