import type { Metadata } from 'next';
import { Suspense } from 'react';
import AcceptInviteHero from '@/components/ns/authentication/AcceptInviteHero';
import { LandingPageShell } from '@/components/ns/landing-page-shell';

export const metadata: Metadata = { title: 'Accept invitation' };

export default function Page() {
  return (
    <LandingPageShell className="bg-background-3 dark:bg-background-7">
      <Suspense>
        <AcceptInviteHero />
      </Suspense>
    </LandingPageShell>
  );
}
