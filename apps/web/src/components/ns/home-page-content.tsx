import About from '@/components/ns/homepage-34/About';
import Blog from '@/components/ns/homepage-34/Blog';
import Clients from '@/components/ns/homepage-34/Clients';
import Contact from '@/components/ns/homepage-34/Contact';
import CTA from '@/components/ns/homepage-34/CTA';
import Feature from '@/components/ns/homepage-34/Feature';
import Hero from '@/components/ns/homepage-34/Hero';
import Pricing from '@/components/ns/homepage-34/Pricing';
import Services from '@/components/ns/homepage-34/Services';
import Steps from '@/components/ns/homepage-34/Steps';
import NSLandingShell from '@/components/ns/NSLandingShell';
import FooterOne from '@/components/ns/shared/FooterOne';
import NavbarFour from '@/components/ns/shared/NavbarFour';
import ReviewsV1 from '@/components/ns/shared/reviews/ReviewsV1';

export default function HomePageContent() {
  return (
    <NSLandingShell>
      <NavbarFour />
      <main>
        <Hero />
        <Clients />
        <Steps />
        <Feature />
        <About />
        <Services />
        <Pricing />
        <ReviewsV1
          badgeColor="badge-green-v2"
          background="lg:pt-[100px] pt-16 lg:pb-[200px] md:pb-[100px] pb-16 bg-background-3 dark:bg-background-9"
          sliderClassName="bg-white dark:bg-background-5"
        />
        <Blog />
        <Contact />
        <CTA />
      </main>
      <FooterOne />
    </NSLandingShell>
  );
}
