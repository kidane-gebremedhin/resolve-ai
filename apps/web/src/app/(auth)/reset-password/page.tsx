import type { Metadata } from 'next';
import ResetPasswordPageContent from '@/components/ns/pages/reset-password-page-content';

export const metadata: Metadata = { title: 'Reset password' };

export default function Page() {
  return <ResetPasswordPageContent />;
}
