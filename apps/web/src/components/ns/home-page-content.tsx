import Contact from '@/components/ns/homepage-34/Contact';
import CTA from '@/components/ns/homepage-34/CTA';
import Feature from '@/components/ns/homepage-34/Feature';
import Hero from '@/components/ns/homepage-01/Hero';
import Pricing from '@/components/ns/homepage-34/Pricing';
import Steps from '@/components/ns/homepage-34/Steps';
import NSLandingShell from '@/components/ns/NSLandingShell';
import FooterOne from '@/components/ns/shared/FooterOne';
import NavbarFour from '@/components/ns/shared/NavbarFour';

// Social-proof / mock-content sections (Clients logo strip, ReviewsV1 testimonials, Blog,
// the stat/founding-year About, and the Services stats marquee) were removed: they carried
// fabricated stats, fake testimonials, placeholder customer logos, and mock images that would
// be misleading on a live site. What remains is honest, product-focused marketing.
export default function HomePageContent() {
  return (
    <NSLandingShell>
      <NavbarFour />
      <main>
        <Hero />
        <Steps />
        <Feature />
        <Pricing />
        <Contact />
        <CTA />
      </main>
      <FooterOne />
    </NSLandingShell>
  );
}
