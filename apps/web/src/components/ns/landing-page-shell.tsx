'use client';

import NSLandingShell from '@/components/ns/NSLandingShell';
import FooterOne from '@/components/ns/shared/FooterOne';
import NavbarFour from '@/components/ns/shared/NavbarFour';

type LandingPageShellProps = {
  children: React.ReactNode;
  className?: string;
};

export function LandingPageShell({ children, className }: LandingPageShellProps) {
  return (
    <NSLandingShell className={className}>
      <NavbarFour />
      <main>{children}</main>
      <FooterOne />
    </NSLandingShell>
  );
}
