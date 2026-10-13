import type { Metadata } from 'next';
import { Suspense } from 'react';
import VerifyEmailHero from '@/components/ns/authentication/VerifyEmailHero';
import { LandingPageShell } from '@/components/ns/landing-page-shell';

export const metadata: Metadata = { title: 'Confirm your email' };

export default function Page() {
  return (
    <LandingPageShell className="bg-background-3 dark:bg-background-7">
      <Suspense>
        <VerifyEmailHero />
      </Suspense>
    </LandingPageShell>
  );
}
