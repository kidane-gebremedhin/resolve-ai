import RevealAnimation from '../animation/RevealAnimation';
import ThemeToggle from './ThemeToggle';
import { APP_NAME, APP_LEGAL_NAME } from '@/lib/app-config';

const socialLinks = [
  { href: 'https://www.facebook.com', label: 'Facebook', icon: '/images/icons/facebook.svg' },
  { href: 'https://www.instagram.com', label: 'Instagram', icon: '/images/icons/instagram.svg' },
  { href: 'https://www.youtube.com', label: 'Youtube', icon: '/images/icons/youtube.svg' },
  { href: 'https://www.linkedin.com', label: 'LinkedIn', icon: '/images/icons/linkedin.svg' },
  { href: 'https://www.dribbble.com', label: 'Dribbble', icon: '/images/icons/dribbble.svg' },
];

const FooterOne = () => {
  return (
    <footer className="bg-secondary dark:bg-background-8 relative overflow-hidden">
      {/* Right gradient */}
      <figure className="pointer-events-none absolute top-[-17%] right-[-64%] size-[550px] rotate-[-30deg] select-none md:top-[-25%] md:right-[-30%] lg:right-[-19%] xl:top-[-32%] xl:right-[-9%]">
        <img src="/images/gradient/gradient-1.png" alt="" className="size-full object-cover object-top" />
      </figure>
      {/* Left gradient */}
      <figure className="pointer-events-none absolute bottom-[-33%] left-[-83%] size-[728px] select-none md:bottom-[-60%] md:left-[-52%] md:size-[870px] lg:left-[-38%] xl:bottom-[-77%] xl:left-[-30%] 2xl:left-[-22%]">
        <img src="/images/gradient/gradient-2.png" alt="" className="size-full object-bottom" />
      </figure>

      <div className="main-container px-5">
        <div className="grid grid-cols-12 justify-between gap-x-0 gap-y-16 pt-16 pb-12 xl:pt-[90px]">
          <div className="col-span-12 xl:col-span-4">
            <RevealAnimation delay={0.3}>
              <div className="max-w-[306px]">
                <figure>
                  <img src="/images/shared/dark-logo.svg" alt={`${APP_NAME} Logo`} />
                </figure>
                <p className="text-accent/60 text-[1rem] leading-[150%] mt-4 mb-7 font-normal">
                  Turpis tortor nunc sed amet et faucibus vitae morbi congue sed id mauris.
                </p>
                <div className="flex items-center gap-3">
                  {socialLinks.map((s, i) => (
                    <span key={s.label} className="flex items-center gap-3">
                      {i > 0 && <div className="bg-stroke-1/20 h-6 w-px" />}
                      <a target="_blank" href={s.href} rel="noreferrer" className="footer-social-link">
                        <span className="sr-only">{s.label}</span>
                        <img className="size-6" src={s.icon} alt={s.label} />
                      </a>
                    </span>
                  ))}
                </div>
              </div>
            </RevealAnimation>
          </div>
          <div className="col-span-12 grid grid-cols-12 gap-x-0 gap-y-8 xl:col-span-8">
            <div className="col-span-12 md:col-span-4">
              <RevealAnimation delay={0.4}>
                <div className="space-y-8">
                  <p className="text-[1.25rem] leading-[140%] text-primary-50 font-normal">Company</p>
                  <ul className="space-y-3 sm:space-y-5">
                    <li><a href="/about" className="footer-link">About Us</a></li>
                    <li><a href="/careers" className="footer-link">Career</a></li>
                    <li><a href="/blog" className="footer-link">Blog</a></li>
                    <li><a href="/contact" className="footer-link">Contact Us</a></li>
                  </ul>
                </div>
              </RevealAnimation>
            </div>
            <div className="col-span-12 md:col-span-4">
              <RevealAnimation delay={0.5}>
                <div className="space-y-8">
                  <p className="text-[1.25rem] leading-[140%] text-primary-50 font-normal">Support</p>
                  <ul className="space-y-3 sm:space-y-5">
                    <li><a href="/faq" className="footer-link">FAQ</a></li>
                    <li><a href="/docs" className="footer-link">Documentation</a></li>
                    <li><a href="/tutorials" className="footer-link">Tutorial</a></li>
                    <li><a href="/support" className="footer-link">Support</a></li>
                  </ul>
                </div>
              </RevealAnimation>
            </div>
            <div className="col-span-12 md:col-span-4">
              <RevealAnimation delay={0.6}>
                <div className="space-y-8">
                  <p className="text-[1.25rem] leading-[140%] text-primary-50 font-normal">Legal Policies</p>
                  <ul className="space-y-3 sm:space-y-5">
                    <li><a href="/terms" className="footer-link">Terms &amp; Conditions</a></li>
                    <li><a href="/privacy" className="footer-link">Privacy Policy</a></li>
                    <li><a href="/refund" className="footer-link">Refund Policy</a></li>
                    <li><a href="/gdpr" className="footer-link">GDPR Compliance</a></li>
                  </ul>
                </div>
              </RevealAnimation>
            </div>
          </div>
        </div>
        <div className="relative pt-[26px] pb-[100px] text-center">
          <div className="bg-accent/10 dark:bg-stroke-4/10 absolute top-0 right-0 left-0 mx-auto h-px w-full" />
          <RevealAnimation delay={0.7} offset={10} start="top 105%">
            <p className="text-[1rem] leading-[150%] text-primary-50 font-normal">
              Copyright &copy; {APP_LEGAL_NAME} – smart application for modern business
            </p>
          </RevealAnimation>
        </div>
      </div>
      <ThemeToggle />
    </footer>
  );
};

export default FooterOne;
