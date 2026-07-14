'use client';

import ForgotPasswordHero from '@/components/ns/authentication/ForgotPasswordHero';
import { LandingPageShell } from '@/components/ns/landing-page-shell';

export default function ForgotPasswordPageContent() {
  return (
    <LandingPageShell className="bg-background-3 dark:bg-background-7">
      <ForgotPasswordHero />
    </LandingPageShell>
  );
}
