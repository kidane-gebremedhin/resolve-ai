'use client';

import LoginHero from '@/components/ns/authentication/LoginHero';
import { LandingPageShell } from '@/components/ns/landing-page-shell';

export default function LoginPageContent() {
  return (
    <LandingPageShell className="bg-background-3 dark:bg-background-7">
      <LoginHero />
    </LandingPageShell>
  );
}
