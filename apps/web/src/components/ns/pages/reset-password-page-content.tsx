'use client';

import { Suspense } from 'react';
import ResetPasswordHero from '@/components/ns/authentication/ResetPasswordHero';
import { LandingPageShell } from '@/components/ns/landing-page-shell';

export default function ResetPasswordPageContent() {
  return (
    <LandingPageShell className="bg-background-3 dark:bg-background-7">
      <Suspense>
        <ResetPasswordHero />
      </Suspense>
    </LandingPageShell>
  );
}
