import type { Metadata } from 'next';
import LoginPageContent from '@/components/ns/pages/login-page-content';

export const metadata: Metadata = {
  title: 'Log in',
};

export default function Page() {
  return <LoginPageContent />;
}
