'use client';

import SignupHero from '@/components/ns/authentication/SignupHero';
import { LandingPageShell } from '@/components/ns/landing-page-shell';

export default function SignupPageContent() {
  return (
    <LandingPageShell className="bg-background-3 dark:bg-background-7">
      <SignupHero />
    </LandingPageShell>
  );
}
