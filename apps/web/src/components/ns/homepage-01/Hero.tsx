import RevealAnimation from '../animation/RevealAnimation';
import HeroDotBg from '../shared/HeroDotBg';
import LinkButton from '../ui/button/LinkButton';
import VerticalLine from './VerticalLine';
import { APP_NAME } from '@/lib/app-config';

const Hero = () => {
  return (
    <section className="bg-background-3 dark:bg-background-5 relative overflow-hidden pt-[200px] pb-16 lg:pb-[100px] 2xl:pt-[250px]">
      <HeroDotBg />
      <VerticalLine />

      <div className="main-container relative z-20 flex flex-col items-center text-center" suppressHydrationWarning>
        <span className="badge badge-green mb-5 hero-reveal-up" style={{ animationDelay: '0.05s' }}>
          AI customer support
        </span>

        <h1 className="mb-4 font-medium hero-reveal-up" style={{ animationDelay: '0.1s' }}>
          Answer customers instantly with <span className="text-primary-500">{APP_NAME}</span>
          <br className="hidden md:block" />
          on every page of your site.
        </h1>

        <p className="mb-7 max-w-[700px] md:mb-10 lg:mb-14 hero-reveal-up" style={{ animationDelay: '0.2s' }}>
          {APP_NAME} embeds an AI support agent trained on your own help docs and website. It answers
          questions in seconds, takes real actions through your tools, and hands off cleanly to your
          team, with every conversation in one shared inbox.
        </p>

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
                See features
              </LinkButton>
            </li>
          </RevealAnimation>
        </ul>
      </div>
    </section>
  );
};

Hero.displayName = 'Hero';
export default Hero;
