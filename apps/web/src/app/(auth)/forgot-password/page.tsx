import type { Metadata } from 'next';
import ForgotPasswordPageContent from '@/components/ns/pages/forgot-password-page-content';

export const metadata: Metadata = { title: 'Forgot password' };

export default function Page() {
  return <ForgotPasswordPageContent />;
}
