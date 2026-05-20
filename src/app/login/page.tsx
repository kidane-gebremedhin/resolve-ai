import LoginHero from '@/components/ns/authentication/LoginHero';
import FooterOne from '@/components/ns/shared/FooterOne';
import NavbarFour from '@/components/ns/shared/NavbarFour';
import NSLandingShell from '@/components/ns/NSLandingShell';

function Page() {
  return (
    <NSLandingShell className="bg-background-3 dark:bg-background-7">
      <NavbarFour />
      <main>
        <LoginHero />
      </main>
      <FooterOne />
    </NSLandingShell>
  );
}


export default Page;
