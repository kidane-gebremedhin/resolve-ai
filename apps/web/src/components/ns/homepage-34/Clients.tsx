import { cn } from '@/utils/ns-cn';
import ClientMarquee from '../ClientMarquee';

const clientLogos = [
  { id: 1, light: '/images/icons/client-logo-6.svg', dark: '/images/icons/client-logo-6-dark.svg', alt: 'Client logo' },
  { id: 2, light: '/images/icons/client-logo-7.svg', dark: '/images/icons/client-logo-7-dark.svg', alt: 'Client logo' },
  { id: 3, light: '/images/icons/client-logo-8.svg', dark: '/images/icons/client-logo-8-dark.svg', alt: 'Client logo' },
  { id: 4, light: '/images/icons/client-logo-9.svg', dark: '/images/icons/client-logo-9-dark.svg', alt: 'Client logo' },
  { id: 5, light: '/images/icons/client-logo-10.svg', dark: '/images/icons/client-logo-10-dark.svg', alt: 'Client logo' },
];

const Clients = () => {
  return (
    <section className="lg:py-[150px] py-10 md:py-[75px] mt-14 xl:mt-[250px] lg:mt-[200px] sm:mt-[150px] hero-reveal-up" style={{ animationDelay: '0.1s' }}>
      <div className="main-container">
        <div className="relative max-w-[1000px] mx-auto">
          <div className="absolute left-0 top-0 h-full w-[15%] md:w-[20%] z-40" style={{ background: 'linear-gradient(to right, #f9fafb, transparent)' }} />
          <div className="absolute right-0 top-0 h-full w-[15%] md:w-[20%] z-40" style={{ background: 'linear-gradient(to left, #f9fafb, transparent)' }} />
          <ClientMarquee>
            <div className="flex items-center justify-center gap-8">
              {clientLogos.map((logo, index) => (
                <figure key={logo.id} aria-label="Client brand logo" className={cn('min-w-[140px] md:min-w-[201px]', index === 0 && 'ml-8')}>
                  <img src={logo.light} alt={logo.alt} className="block dark:hidden" />
                  <img src={logo.dark} alt={logo.alt} className="hidden dark:block" />
                </figure>
              ))}
            </div>
          </ClientMarquee>
        </div>
      </div>
    </section>
  );
};

export default Clients;
