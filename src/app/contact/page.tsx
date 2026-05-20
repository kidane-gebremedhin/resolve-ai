import Contact from '@/components/ns/homepage-34/Contact';
import FooterOne from '@/components/ns/shared/FooterOne';
import NavbarFour from '@/components/ns/shared/NavbarFour';
import NSLandingShell from '@/components/ns/NSLandingShell';

function Page() {
  return (
    <NSLandingShell>
      <NavbarFour />
      <main>
        <Contact />
      </main>
      <FooterOne />
    </NSLandingShell>
  );
}


export default Page;
