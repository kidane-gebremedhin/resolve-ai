import Image from 'next/image';
import Marquee from 'react-fast-marquee';
import RevealAnimation from '../animation/RevealAnimation';
import HeroDotBg from '../shared/HeroDotBg';
import LinkButton from '../ui/button/LinkButton';
import VerticalLine from './VerticalLine';
import { APP_NAME } from '@/lib/app-config';

const heroAssetLight = {
  one: '/images/home-page-1/hero-asset-1.svg',
  two: '/images/home-page-1/hero-asset-2.png',
  three: '/images/home-page-1/hero-asset-3.png',
  four: '/images/home-page-1/hero-asset-4.svg',
};

const heroAssetDark = {
  one: '/images/home-page-1/hero-asset-dark-1.svg',
  two: '/images/home-page-1/hero-asset-2-dark.png',
  three: '/images/home-page-1/hero-asset-dark-3.png',
  four: '/images/home-page-1/hero-asset-dark-4.svg',
};

const avatars = [
  { src: '/images/avatar/avatar-1.png', alt: 'Customer avatar 1' },
  { src: '/images/avatar/avatar-2.png', alt: 'Customer avatar 2' },
  { src: '/images/avatar/avatar-3.png', alt: 'Customer avatar 3' },
];

const clientLogos = [
  { light: '/images/icons/client-logo-1.svg', dark: '/images/icons/client-logo-1-dark.svg' },
  { light: '/images/icons/client-logo-2.svg', dark: '/images/icons/client-logo-2-dark.svg' },
  { light: '/images/icons/client-logo-3.svg', dark: '/images/icons/client-logo-3-dark.svg' },
  { light: '/images/icons/client-logo-4.svg', dark: '/images/icons/client-logo-4-dark.svg' },
  { light: '/images/icons/client-logo-5.svg', dark: '/images/icons/client-logo-5-dark.svg' },
];

const Hero = () => {
  return (
    <RevealAnimation direction="up" offset={0}>
      <section className="bg-background-3 dark:bg-background-5 relative overflow-hidden pt-[200px] pb-16 lg:pb-[100px] 2xl:pt-[250px]">
        <HeroDotBg />
        <VerticalLine />

        <div className="main-container relative z-20 flex flex-col items-center text-center">
          <RevealAnimation delay={0.1} duration={2} useSpring={true}>
            <figure className="absolute -top-[12%] -left-[3%] w-[150px] rotate-[-7deg] min-[1535px]:!-left-[10%] min-[1735px]:!-left-[16%] sm:-top-[15%] sm:w-[200px] lg:-top-[5%] lg:-left-[1%] lg:w-[220px] xl:w-[350px] 2xl:w-fit">
              <Image
                src={heroAssetLight.one}
                alt="Hero asset 1"
                width={350}
                height={350}
                className="inline-block h-full w-full rounded-2xl object-cover dark:hidden"
              />
              <Image
                src={heroAssetDark.one}
                alt="Hero asset 1"
                width={350}
                height={350}
                className="hidden h-full w-full object-cover dark:inline-block"
              />
            </figure>
          </RevealAnimation>

          <RevealAnimation delay={0.2} duration={2} useSpring={true}>
            <figure className="absolute hidden rotate-[11deg] min-[1535px]:!bottom-[18%] min-[1535px]:!-left-[5%] min-[1735px]:!bottom-[18%] min-[1735px]:!-left-[12.5%] md:bottom-[67%] md:left-[1%] md:block md:w-[140px] lg:bottom-[52%] lg:left-[2%] lg:w-[180px] xl:bottom-[30%] xl:w-[250px] 2xl:w-[275px]">
              <Image
                src={heroAssetLight.two}
                alt="Hero asset 2"
                width={275}
                height={275}
                className="inline-block h-full w-full object-cover shadow-none outline-0 dark:hidden"
              />
              <Image
                src={heroAssetDark.two}
                alt="Hero asset 2"
                width={275}
                height={275}
                className="hidden h-full w-full object-cover shadow-none outline-0 dark:inline-block"
              />
            </figure>
          </RevealAnimation>

          <RevealAnimation delay={0.1} duration={2} useSpring={true}>
            <figure className="absolute -top-[12%] right-[4%] w-[120px] rotate-[4deg] sm:-top-[14%] md:w-[140px] lg:-top-[1.4%] lg:right-[2%] lg:w-[170px] xl:top-[5%] xl:right-[3%] xl:w-[200px] 2xl:top-[1%] 2xl:-right-[8.0%] 2xl:w-[280px]">
              <Image
                src={heroAssetLight.three}
                alt="Hero asset 3"
                width={280}
                height={280}
                className="inline-block h-full w-full rounded-2xl object-cover dark:hidden"
              />
              <Image
                src={heroAssetDark.three}
                alt="Hero asset 3"
                width={280}
                height={280}
                className="hidden h-full w-full rounded-2xl object-cover dark:inline-block"
              />
            </figure>
          </RevealAnimation>

          <RevealAnimation delay={0.2} duration={2} useSpring={true}>
            <figure className="absolute right-[4%] hidden rotate-[-7deg] min-[1535px]:!-right-[12%] min-[1735px]:!-right-[18%] md:bottom-[67%] md:block md:w-[140px] lg:right-[1%] lg:bottom-[57%] lg:w-[180px] xl:-right-[1%] xl:bottom-[41%] xl:w-[250px] 2xl:bottom-[20%] 2xl:w-fit">
              <Image
                src={heroAssetLight.four}
                alt="Hero asset 4"
                width={275}
                height={275}
                className="inline-block h-full w-full rounded-2xl object-cover dark:hidden"
              />
              <Image
                src={heroAssetDark.four}
                alt="Hero asset 4"
                width={275}
                height={275}
                className="hidden h-full w-full rounded-2xl object-cover dark:inline-block"
              />
            </figure>
          </RevealAnimation>

          <RevealAnimation delay={0.05}>
            <span className="badge badge-green mb-5">AI customer support</span>
          </RevealAnimation>

          <RevealAnimation delay={0.1}>
            <h1 className="mb-4 font-medium">
              Resolve tickets faster with <span className="text-primary-500">{APP_NAME}</span>
              <br className="hidden md:block" />
              on every page of your site.
            </h1>
          </RevealAnimation>

          <RevealAnimation delay={0.2}>
            <p className="mb-7 max-w-[700px] md:mb-10 lg:mb-14">
              {APP_NAME} embeds a grounded AI agent in your website, plugs into a unified inbox,
              and resolves 68% of tickets automatically — so your team focuses on the ones that
              really need a human.
            </p>
          </RevealAnimation>

          <ul className="mx-auto mb-9 flex flex-col gap-4 max-md:w-full md:mx-0 md:mb-11 md:w-auto md:flex-row lg:mb-14">
            <RevealAnimation delay={0.3} direction="left" offset={50}>
              <li>
                <LinkButton
                  href="/pricing"
                  className="btn btn-primary hover:btn-white-dark dark:hover:btn-white btn-lg md:btn-xl mx-auto w-full md:mx-0 md:w-auto"
                >
                  Get started
                </LinkButton>
              </li>
            </RevealAnimation>

            <RevealAnimation delay={0.5} direction="left" offset={50}>
              <li>
                <LinkButton
                  href="/features"
                  className="btn btn-white hover:btn-primary dark:btn-white-dark btn-lg md:btn-xl mx-auto w-full md:mx-0 md:w-auto"
                >
                  Try live demo
                </LinkButton>
              </li>
            </RevealAnimation>
          </ul>

          <div className="mb-20 flex items-center justify-center gap-4 max-[375px]:flex-col lg:mb-[100px]">
            <div className="flex -space-x-3.5">
              {avatars.map((avatar, idx) => (
                <RevealAnimation delay={0.1 * (idx + 2)} direction="right" offset={50} key={idx}>
                  <Image
                    className="bg-ns-green inline-block size-12 rounded-full ring-2 ring-white dark:ring-black"
                    src={avatar.src}
                    alt={avatar.alt}
                    width={48}
                    height={48}
                  />
                </RevealAnimation>
              ))}
              <RevealAnimation delay={0.5} direction="right" offset={50}>
                <div className="text-secondary/80 bg-ns-green text-tagline-3 inline-flex size-12 items-center justify-center rounded-full font-medium ring-2 ring-white dark:ring-black">
                  99+
                </div>
              </RevealAnimation>
            </div>

            <RevealAnimation delay={0.6} direction="right" offset={50}>
              <div className="text-left max-[375px]:text-center">
                <p className="text-tagline-2 text-secondary dark:text-accent block font-medium">
                  Trusted by 20k+
                </p>
                <p className="text-tagline-3">Support teams across the globe</p>
              </div>
            </RevealAnimation>
          </div>

          <RevealAnimation instant delay={0.6}>
            <div className="relative mx-auto w-[375px] sm:w-[640px] md:w-[768px] lg:w-[1024px] xl:w-[1100px]">
              <div className="from-background-3 dark:from-background-5 absolute top-0 left-0 z-40 h-full w-[30%] bg-gradient-to-r to-transparent"></div>
              <div className="from-background-3 dark:from-background-5 absolute top-0 right-0 z-40 h-full w-[30%] bg-gradient-to-l to-transparent"></div>

              <Marquee autoFill speed={40}>
                <div className="flex items-center justify-center gap-8">
                  {clientLogos.map((logo, index) => (
                    <figure key={index} className={`w-28 md:w-36 ${index === 0 ? 'ml-8' : ''}`}>
                      <Image
                        src={logo.light}
                        alt={`Client logo ${index + 1}`}
                        width={144}
                        height={48}
                        className="inline-block lg:w-auto dark:hidden"
                      />
                      <Image
                        src={logo.dark}
                        alt={`Client logo ${index + 1}`}
                        width={144}
                        height={48}
                        className="hidden lg:w-auto dark:inline-block"
                      />
                    </figure>
                  ))}
                </div>
              </Marquee>
            </div>
          </RevealAnimation>
        </div>
      </section>
    </RevealAnimation>
  );
};

Hero.displayName = 'Hero';
export default Hero;
